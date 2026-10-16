// resource-meter supervises an unchanged container command. All samples remain
// in memory; only the final, small summary is written to the termination message.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type sample struct {
	cpu    uint64
	memory uint64
	at     time.Time
}

type report struct {
	Status   string  `json:"status"`
	CPU      float64 `json:"cpuCoreSeconds"`
	Memory   float64 `json:"memoryByteSeconds"`
	Duration float64 `json:"durationSeconds"`
	Peak     uint64  `json:"peakMemoryBytes"`
	Samples  int     `json:"samples"`
}

type meter struct {
	first, last sample
	result      report
}

func (m *meter) add(s sample) {
	if m.result.Samples == 0 {
		m.first = s
	} else {
		m.result.Memory += s.at.Sub(m.last.at).Seconds() * (float64(m.last.memory) + float64(s.memory)) / 2
	}
	m.last = s
	// A new container owns a new cgroup. Use its lifetime counter, including
	// startup before our first sample, not the difference between two scrapes.
	m.result.CPU = float64(s.cpu) / 1e6
	m.result.Duration = s.at.Sub(m.first.at).Seconds()
	if s.memory > m.result.Peak {
		m.result.Peak = s.memory
	}
	m.result.Samples++
}

func counter(data, name string) (uint64, error) {
	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == name {
			return strconv.ParseUint(fields[1], 10, 64)
		}
	}
	return 0, fmt.Errorf("missing cgroup counter %s", name)
}

// Resolve the current cgroup against the visible cgroup2 mount, rather than
// accidentally measuring the node when the cgroup namespace is not private.
func locate(groups, mounts string) (string, error) {
	group := ""
	for _, line := range strings.Split(groups, "\n") {
		if strings.HasPrefix(line, "0::") {
			group = strings.TrimPrefix(line, "0::")
		}
	}
	for _, line := range strings.Split(mounts, "\n") {
		parts := strings.SplitN(line, " - ", 2)
		if len(parts) != 2 || !strings.HasPrefix(parts[1], "cgroup2 ") {
			continue
		}
		fields := strings.Fields(parts[0])
		if len(fields) < 5 || group == "" {
			continue
		}
		root, mount := fields[3], fields[4]
		if group == "/" {
			return mount, nil
		} // private cgroup namespace
		if group != root && !strings.HasPrefix(group, strings.TrimSuffix(root, "/")+"/") {
			continue
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(group, root), "/")
		if strings.Contains(rel, "..") {
			continue
		}
		return filepath.Join(mount, rel), nil
	}
	return "", fmt.Errorf("current cgroup2 mount unavailable")
}

func readSample(root string) (sample, error) {
	cpu, err := os.ReadFile(filepath.Join(root, "cpu.stat"))
	if err != nil {
		return sample{}, err
	}
	usage, err := counter(string(cpu), "usage_usec")
	if err != nil {
		return sample{}, err
	}
	memory, err := os.ReadFile(filepath.Join(root, "memory.current"))
	if err != nil {
		return sample{}, err
	}
	current, err := strconv.ParseUint(strings.TrimSpace(string(memory)), 10, 64)
	if err != nil {
		return sample{}, err
	}
	stat, err := os.ReadFile(filepath.Join(root, "memory.stat"))
	if err != nil {
		return sample{}, err
	}
	inactive, err := counter(string(stat), "inactive_file")
	if err != nil {
		return sample{}, err
	}
	working := uint64(0)
	if current > inactive {
		working = current - inactive
	}
	return sample{usage, working, time.Now()}, nil
}

func writeReport(path string, r report) error {
	// files-in already reports transfers here. Preserve them instead of
	// replacing the existing offloading transport measurement.
	data := map[string]any{}
	if previous, err := os.ReadFile(path); err == nil && len(previous) > 0 {
		if json.Unmarshal(previous, &data) != nil || data == nil {
			data = map[string]any{"message": string(previous[:min(len(previous), 512)])}
		}
	}
	data["resources"] = r
	encoded, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if len(encoded) > 3500 {
		encoded, err = json.Marshal(map[string]any{"resources": r, "message": "original termination message too large"})
	}
	if err != nil {
		return err
	}
	return os.WriteFile(path, encoded, 0644)
}

func run(args []string) int {
	if len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "resource-meter: command required")
		return 127
	}
	groups, gerr := os.ReadFile("/proc/self/cgroup")
	mounts, merr := os.ReadFile("/proc/self/mountinfo")
	root, err := locate(string(groups), string(mounts))
	m := meter{result: report{Status: "COMPLETE"}}
	available := gerr == nil && merr == nil && err == nil
	take := func() {
		if !available {
			return
		}
		s, e := readSample(root)
		if e != nil || (m.result.Samples > 0 && s.cpu < m.last.cpu) {
			available = false
			return
		}
		m.add(s)
	}
	take()
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	defer signal.Stop(signals)
	code := 0
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "resource-meter: command could not start")
		code = 127
	} else {
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		ticker := time.NewTicker(100 * time.Millisecond)
	wait:
		for {
			select {
			case <-ticker.C:
				take()
			case s := <-signals:
				_ = syscall.Kill(-cmd.Process.Pid, s.(syscall.Signal))
			case e := <-done:
				if e != nil {
					code = cmd.ProcessState.ExitCode()
					if status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus); ok && status.Signaled() {
						code = 128 + int(status.Signal())
					}
				}
				break wait
			}
		}
		ticker.Stop()
	}
	take()
	if !available {
		m.result.Status = "INCOMPLETE"
	}
	if err := writeReport("/dev/termination-log", m.result); err != nil {
		fmt.Fprintln(os.Stderr, "resource-meter: summary could not be saved")
	}
	return code
}

func main() { os.Exit(run(os.Args[1:])) }

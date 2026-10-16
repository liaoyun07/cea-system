package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIntegrationAndLifetimeCPU(t *testing.T) {
	m := meter{}
	now := time.Now()
	m.add(sample{200000, 100, now})
	m.add(sample{1200000, 300, now.Add(2 * time.Second)})
	if m.result.CPU != 1.2 || m.result.Memory != 400 || m.result.Duration != 2 || m.result.Peak != 300 || m.result.Samples != 2 {
		t.Fatal(m.result)
	}
}
func TestCgroupLocation(t *testing.T) {
	for _, tc := range []struct{ group, root, want string }{
		{"/", "/docker/id", "/sys/fs/cgroup"},
		{"/cea-cloud/pod/container", "/", "/sys/fs/cgroup/cea-cloud/pod/container"},
		{"/docker/id/sub", "/docker/id", "/sys/fs/cgroup/sub"},
	} {
		got, err := locate("0::"+tc.group+"\n", "1 0 0:1 "+tc.root+" /sys/fs/cgroup ro - cgroup2 cgroup rw")
		if err != nil || got != tc.want {
			t.Fatalf("%+v: %s %v", tc, got, err)
		}
	}
	if _, err := locate("0::/other", "1 0 0:1 /docker/id /sys/fs/cgroup ro - cgroup2 cgroup rw"); err == nil {
		t.Fatal("must not read another cgroup")
	}
}
func TestReadsActualCountersAndClampsCache(t *testing.T) {
	dir := t.TempDir()
	for name, data := range map[string]string{"cpu.stat": "usage_usec 1200000\n", "memory.current": "300\n", "memory.stat": "inactive_file 100\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s, err := readSample(dir)
	if err != nil || s.cpu != 1200000 || s.memory != 200 {
		t.Fatal(s, err)
	}
	os.WriteFile(filepath.Join(dir, "memory.stat"), []byte("inactive_file 400\n"), 0600)
	s, err = readSample(dir)
	if err != nil || s.memory != 0 {
		t.Fatal(s, err)
	}
	os.Remove(filepath.Join(dir, "cpu.stat"))
	if _, err = readSample(dir); err == nil {
		t.Fatal("missing CPU must not become zero")
	}
}
func TestPreservesInputTransferReport(t *testing.T) {
	file := filepath.Join(t.TempDir(), "report")
	os.WriteFile(file, []byte(`{"transfers":[{"name":"data","bytes":12,"seconds":0.3}]}`), 0600)
	if err := writeReport(file, report{Status: "COMPLETE", CPU: 0.2}); err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	raw, _ := os.ReadFile(file)
	json.Unmarshal(raw, &value)
	if value["transfers"] == nil || value["resources"].(map[string]any)["cpuCoreSeconds"] != 0.2 {
		t.Fatal(value)
	}
}

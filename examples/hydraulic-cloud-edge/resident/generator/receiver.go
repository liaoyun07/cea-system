// HC-13 transport-only receiver. It verifies every uploaded byte but performs
// no hydraulic computation and stores neither request bodies nor results.
package main

import (
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type receiverStats struct {
	Requests uint64 `json:"requests"`
	Bytes    uint64 `json:"bytes"`
	Failed   uint64 `json:"failed"`
	Inflight uint64 `json:"inflight"`
}

type receipt struct {
	Bytes  int64  `json:"bytes"`
	CRC32C string `json:"crc32c"`
}

type receiver struct {
	mu        sync.Mutex
	stats     receiverStats
	buffers   sync.Pool
	cgroupDir string
}

type resourceSample struct {
	At              float64 `json:"at"`
	CPUUsec         uint64  `json:"cpuUsec"`
	ThrottledUsec   uint64  `json:"throttledUsec"`
	WorkingSetBytes uint64  `json:"workingSetBytes"`
	CPUMax          string  `json:"cpuMax"`
	MemoryMax       string  `json:"memoryMax"`
}

var castagnoli = crc32.MakeTable(crc32.Castagnoli)

func newReceiver() *receiver {
	return &receiver{cgroupDir: "/sys/fs/cgroup", buffers: sync.Pool{New: func() any {
		buffer := make([]byte, 64*1024)
		return &buffer
	}}}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *receiver) snapshot() receiverStats {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stats
}

func (s *receiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	method := http.MethodGet
	if r.URL.Path == "/ingest" || r.URL.Path == "/reset" {
		method = http.MethodPost
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	switch r.URL.Path {
	case "/health":
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	case "/stats":
		writeJSON(w, http.StatusOK, s.snapshot())
	case "/resources":
		sample, err := readResources(s.cgroupDir)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, sample)
	case "/reset":
		s.mu.Lock()
		if s.stats.Inflight != 0 {
			s.mu.Unlock()
			writeJSON(w, http.StatusConflict, map[string]string{"error": "uploads still in flight"})
			return
		}
		s.stats = receiverStats{}
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, receiverStats{})
	case "/ingest":
		s.ingest(w, r)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func statValue(content, name string) (uint64, error) {
	for _, line := range strings.Split(content, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == name {
			return strconv.ParseUint(fields[1], 10, 64)
		}
	}
	return 0, fmt.Errorf("cgroup stat %s missing", name)
}

func readResources(directory string) (resourceSample, error) {
	var sample resourceSample
	values := make(map[string]string, 5)
	for _, name := range []string{"cpu.stat", "memory.current", "memory.stat", "cpu.max", "memory.max"} {
		content, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return sample, err
		}
		values[name] = strings.TrimSpace(string(content))
		if values[name] == "" {
			return sample, fmt.Errorf("cgroup file %s empty", name)
		}
	}
	var err error
	if sample.CPUUsec, err = statValue(values["cpu.stat"], "usage_usec"); err != nil {
		return sample, err
	}
	if sample.ThrottledUsec, err = statValue(values["cpu.stat"], "throttled_usec"); err != nil {
		return sample, err
	}
	current, err := strconv.ParseUint(values["memory.current"], 10, 64)
	if err != nil {
		return sample, err
	}
	inactive, err := statValue(values["memory.stat"], "inactive_file")
	if err != nil {
		return sample, err
	}
	// The two cgroup files are read separately. Clamp a transient negative
	// difference rather than underflowing an unsigned working-set value.
	if current > inactive {
		sample.WorkingSetBytes = current - inactive
	}
	sample.CPUMax = values["cpu.max"]
	sample.MemoryMax = values["memory.max"]
	sample.At = float64(time.Now().UnixNano()) / 1e9
	return sample, nil
}

func (s *receiver) ingest(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.stats.Inflight++
	s.mu.Unlock()
	var received int64
	accepted := false
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.stats.Inflight--
		if accepted {
			s.stats.Requests++
			s.stats.Bytes += uint64(received)
		} else {
			s.stats.Failed++
		}
	}()

	expectedBytes, lengthErr := strconv.ParseInt(r.Header.Get("X-Expected-Bytes"), 10, 64)
	expectedCRCText := r.Header.Get("X-Expected-Crc32c")
	expectedCRC, crcErr := strconv.ParseUint(expectedCRCText, 16, 32)
	if lengthErr != nil || expectedBytes < 0 || crcErr != nil || len(expectedCRCText) != 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "expected byte length and eight-digit CRC32C headers required"})
		return
	}
	buffer := s.buffers.Get().(*[]byte)
	defer s.buffers.Put(buffer)
	hash := crc32.New(castagnoli)
	var readErr error
	received, readErr = io.CopyBuffer(hash, r.Body, *buffer)
	actual := receipt{Bytes: received, CRC32C: fmt.Sprintf("%08x", hash.Sum32())}
	if readErr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "body read failed: " + readErr.Error(), "bytes": received, "crc32c": actual.CRC32C})
		return
	}
	if received != expectedBytes || hash.Sum32() != uint32(expectedCRC) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "body length or CRC32C mismatch", "bytes": received, "crc32c": actual.CRC32C})
		return
	}
	accepted = true
	writeJSON(w, http.StatusOK, actual)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           newReceiver(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	log.Printf("HC-13 transport receiver listening on %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}

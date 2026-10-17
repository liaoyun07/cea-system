package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func uploadRequest(url string, body []byte) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, url+"/ingest", bytes.NewReader(body))
	r.Header.Set("X-Expected-Bytes", fmt.Sprint(len(body)))
	r.Header.Set("X-Expected-Crc32c", fmt.Sprintf("%08x", crc32.Checksum(body, castagnoli)))
	return r
}

func TestCompleteBodyAndReceipt(t *testing.T) {
	s := newReceiver()
	server := httptest.NewServer(s)
	defer server.Close()
	body := bytes.Repeat([]byte("NPZ binary payload\x00\xff"), 10000)
	r := uploadRequest(server.URL, body)
	r.Header.Set("X-Expected-Crc32c", strings.ToUpper(r.Header.Get("X-Expected-Crc32c")))
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var got receipt
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || got.Bytes != int64(len(body)) || got.CRC32C != fmt.Sprintf("%08x", crc32.Checksum(body, castagnoli)) {
		t.Fatalf("invalid receipt: status=%d receipt=%+v", resp.StatusCode, got)
	}
	if got := s.snapshot(); got != (receiverStats{Requests: 1, Bytes: uint64(len(body))}) {
		t.Fatalf("invalid stats: %+v", got)
	}
}

func TestCorruptOrWrongLengthIsNotSuccessful(t *testing.T) {
	for _, kind := range []string{"checksum", "length", "missing headers"} {
		t.Run(kind, func(t *testing.T) {
			s := newReceiver()
			body := []byte("original payload")
			r := uploadRequest("http://receiver", body)
			switch kind {
			case "checksum":
				r.Header.Set("X-Expected-Crc32c", "00000000")
			case "length":
				r.Header.Set("X-Expected-Bytes", fmt.Sprint(len(body)+1))
			default:
				r.Header.Del("X-Expected-Crc32c")
			}
			out := httptest.NewRecorder()
			s.ServeHTTP(out, r)
			if out.Code != http.StatusBadRequest || s.snapshot() != (receiverStats{Failed: 1}) {
				t.Fatalf("invalid failure handling: status=%d stats=%+v", out.Code, s.snapshot())
			}
		})
	}
}

func TestTruncatedHTTPBody(t *testing.T) {
	s := newReceiver()
	server := httptest.NewServer(s)
	defer server.Close()
	conn, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	body := []byte("complete payload")
	_, err = fmt.Fprintf(conn, "POST /ingest HTTP/1.1\r\nHost: receiver\r\nContent-Length: %d\r\nX-Expected-Bytes: %d\r\nX-Expected-Crc32c: %08x\r\nConnection: close\r\n\r\n%s", len(body), len(body), crc32.Checksum(body, castagnoli), body[:3])
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.(*net.TCPConn).CloseWrite(); err != nil {
		t.Fatal(err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	content, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusBadRequest || !bytes.Contains(content, []byte("unexpected EOF")) {
		t.Fatalf("truncated body accepted: status=%d body=%s", resp.StatusCode, content)
	}
	if got := s.snapshot(); got != (receiverStats{Failed: 1}) {
		t.Fatalf("truncated body counted as success: %+v", got)
	}
}

func TestConcurrentUploadsExactAccounting(t *testing.T) {
	s := newReceiver()
	server := httptest.NewServer(s)
	defer server.Close()
	const parallel = 32
	body := bytes.Repeat([]byte("0123456789abcdef"), 16384)
	var work sync.WaitGroup
	for i := 0; i < parallel; i++ {
		work.Add(1)
		go func() {
			defer work.Done()
			resp, err := http.DefaultClient.Do(uploadRequest(server.URL, body))
			if err != nil {
				t.Error(err)
				return
			}
			defer resp.Body.Close()
			var got receipt
			if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
				t.Error(err)
			} else if resp.StatusCode != http.StatusOK || got.Bytes != int64(len(body)) || got.CRC32C != fmt.Sprintf("%08x", crc32.Checksum(body, castagnoli)) {
				t.Errorf("invalid concurrent receipt: status=%d receipt=%+v", resp.StatusCode, got)
			}
		}()
	}
	work.Wait()
	if got := s.snapshot(); got != (receiverStats{Requests: parallel, Bytes: uint64(parallel * len(body))}) {
		t.Fatalf("inexact concurrent accounting: %+v", got)
	}
}

func TestResetRejectedDuringUploadAndClearsIdleStats(t *testing.T) {
	s := newReceiver()
	body := []byte("upload held in flight")
	r := uploadRequest("http://receiver", body)
	reader, writer := io.Pipe()
	r.Body = reader
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.ServeHTTP(httptest.NewRecorder(), r)
	}()
	// A successful pipe write means the handler has entered its body read.
	if _, err := writer.Write(body[:1]); err != nil {
		t.Fatal(err)
	}
	out := httptest.NewRecorder()
	s.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/reset", nil))
	if out.Code != http.StatusConflict || s.snapshot().Inflight != 1 {
		t.Errorf("reset allowed with live upload: status=%d stats=%+v", out.Code, s.snapshot())
	}
	_, _ = writer.Write(body[1:])
	_ = writer.Close()
	<-done
	if got := s.snapshot(); got != (receiverStats{Requests: 1, Bytes: uint64(len(body))}) {
		t.Fatalf("upload accounting after rejected reset: %+v", got)
	}
	bad := uploadRequest("http://receiver", body)
	bad.Header.Del("X-Expected-Bytes")
	s.ServeHTTP(httptest.NewRecorder(), bad)
	out = httptest.NewRecorder()
	s.ServeHTTP(out, httptest.NewRequest(http.MethodPost, "/reset", nil))
	if out.Code != http.StatusOK || s.snapshot() != (receiverStats{}) {
		t.Fatalf("idle reset failed: status=%d stats=%+v", out.Code, s.snapshot())
	}
}

func TestStatsHealthAndMethod(t *testing.T) {
	s := newReceiver()
	for _, path := range []string{"/health", "/stats"} {
		out := httptest.NewRecorder()
		s.ServeHTTP(out, httptest.NewRequest(http.MethodGet, path, nil))
		if out.Code != http.StatusOK || out.Header().Get("Content-Type") != "application/json" {
			t.Fatalf("%s unavailable: %d", path, out.Code)
		}
		if path == "/stats" {
			var got receiverStats
			if err := json.Unmarshal(out.Body.Bytes(), &got); err != nil || got != (receiverStats{}) {
				t.Fatalf("invalid stats body: %s", out.Body.String())
			}
		}
	}
	out := httptest.NewRecorder()
	s.ServeHTTP(out, httptest.NewRequest(http.MethodGet, "/ingest", nil))
	if out.Code != http.StatusMethodNotAllowed || out.Header().Get("Allow") != http.MethodPost || s.snapshot() != (receiverStats{}) {
		t.Fatalf("invalid method changed upload accounting: %d %+v", out.Code, s.snapshot())
	}
}

func TestResourcesReadRealCgroupFields(t *testing.T) {
	directory := t.TempDir()
	files := map[string]string{
		"cpu.stat":       "usage_usec 123456\nuser_usec 100000\nthrottled_usec 789\n",
		"memory.current": "1000000\n",
		"memory.stat":    "anon 800000\ninactive_file 200000\n",
		"cpu.max":        "200000 100000\n",
		"memory.max":     "536870912\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := newReceiver()
	s.cgroupDir = directory
	out := httptest.NewRecorder()
	s.ServeHTTP(out, httptest.NewRequest(http.MethodGet, "/resources", nil))
	var sample resourceSample
	if err := json.Unmarshal(out.Body.Bytes(), &sample); err != nil {
		t.Fatal(err)
	}
	if out.Code != http.StatusOK || sample.At <= 0 || sample.CPUUsec != 123456 || sample.ThrottledUsec != 789 || sample.WorkingSetBytes != 800000 || sample.CPUMax != "200000 100000" || sample.MemoryMax != "536870912" {
		t.Fatalf("invalid resource sample: status=%d sample=%+v", out.Code, sample)
	}
	if s.snapshot() != (receiverStats{}) {
		t.Fatalf("resource sampling changed upload statistics: %+v", s.snapshot())
	}
	if err := os.WriteFile(filepath.Join(directory, "memory.current"), []byte("100"), 0600); err != nil {
		t.Fatal(err)
	}
	sample, err := readResources(directory)
	if err != nil || sample.WorkingSetBytes != 0 {
		t.Fatalf("working set underflow: sample=%+v err=%v", sample, err)
	}
}

func TestResourcesMissingFilesOrCountersFail(t *testing.T) {
	s := newReceiver()
	s.cgroupDir = t.TempDir()
	out := httptest.NewRecorder()
	s.ServeHTTP(out, httptest.NewRequest(http.MethodGet, "/resources", nil))
	if out.Code != http.StatusInternalServerError || !strings.Contains(out.Body.String(), "error") {
		t.Fatalf("missing cgroup files returned fake sample: %d %s", out.Code, out.Body.String())
	}
	if _, err := statValue("usage_usec 123\n", "throttled_usec"); err == nil {
		t.Fatal("missing cgroup counter was reported as zero")
	}
	if _, err := statValue("usage_usec invalid\n", "usage_usec"); err == nil {
		t.Fatal("invalid cgroup counter was reported as zero")
	}
}

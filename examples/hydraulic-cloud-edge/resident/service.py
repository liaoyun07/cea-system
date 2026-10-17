"""HC-05 isolated resident HTTP experiment. No Flow/Job/storage API changes."""
import io
import json
import os
import sys
import threading
import time
import traceback
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np
from app import GROUPS, edge, fuse, load
from input_codec import CONTENT_TYPE, decode_input


def unpack(body):
    with np.load(io.BytesIO(body), allow_pickle=False) as source:
        return {name: source[name] for name in source.files}


def pack(arrays):
    buffer = io.BytesIO()
    np.savez(buffer, **arrays)
    return buffer.getvalue()


def reference_for(reference, ids):
    positions = np.searchsorted(reference['cycle_ids'], ids)
    if np.any(positions >= len(reference['cycle_ids'])) or not np.array_equal(reference['cycle_ids'][positions], ids):
        raise ValueError('unknown cycle ids')
    result = dict(reference)
    for name in ('cycle_ids', 'stable', 'healthy'):
        result[name] = reference[name][positions]
    return result


def summary(result, raw_bytes):
    return dict(inputBytes=raw_bytes, cycles=len(result['cycle_ids']),
                scoreSum=float(result['sensor_scores'].sum(dtype=np.float64)),
                flagCount=int(result['window_flags'].sum()))


def counters():
    root = Path('/sys/fs/cgroup')
    cpu = dict(line.split() for line in (root / 'cpu.stat').read_text().splitlines())
    memory = dict(line.split() for line in (root / 'memory.stat').read_text().splitlines())
    return dict(at=time.monotonic(), cpuUsec=int(cpu['usage_usec']),
                throttledUsec=int(cpu.get('throttled_usec', 0)),
                memoryBytes=int((root / 'memory.current').read_text()),
                workingSetBytes=max(0, int((root / 'memory.current').read_text()) - int(memory.get('inactive_file', 0))))


class State:
    def __init__(self, role, reference=None):
        self.role = role
        self.reference = reference
        self.lock = threading.Lock()
        self.compute = threading.Semaphore(1)
        self.run = ''
        self.parts = {}
        self.results = {}
        self.completed = self.raw_bytes = self.errors = 0
        self.samples = []
        self.stage_seconds = dict(decode=0., queue=0., compute=0., encode=0., forward=0.)

    def reset(self, run):
        with self.lock:
            if self.parts or self.results:
                raise ValueError('previous run has unconsumed batches')
            self.run = run
            self.completed = self.raw_bytes = self.errors = 0
            self.samples = [counters()]
            self.stage_seconds = dict.fromkeys(self.stage_seconds, 0.)

    def add_part(self, batch, group, arrays, raw_bytes):
        with self.lock:
            if group not in GROUPS or batch in self.results:
                raise ValueError('unexpected group or completed batch')
            parts = self.parts.setdefault(batch, {})
            if group in parts:
                raise ValueError('duplicate group')
            parts[group] = (arrays, raw_bytes)
            if len(parts) < 3:
                return
            ordered = [parts[g][0] for g in GROUPS]
            started = time.perf_counter()
            result, _ = fuse(ordered, reference_for(self.reference, ordered[0]['cycle_ids']), 3.)
            self.stage_seconds['compute'] += time.perf_counter() - started
            total = sum(v[1] for v in parts.values())
            self.results[batch] = (summary(result, total), result)
            self.completed += 1
            self.raw_bytes += total
            del self.parts[batch]

    def take(self, batch, binary=False):
        with self.lock:
            meta, result = self.results.pop(batch)
        return pack(result) if binary else json.dumps(meta).encode()

    def stats(self):
        with self.lock:
            samples = [*self.samples, counters()]
            return dict(role=self.role, run=self.run, completed=self.completed,
                        inputBytes=self.raw_bytes, errors=self.errors,
                        pending=len(self.parts), unconsumed=len(self.results),
                        stages=self.stage_seconds.copy(), samples=samples,
                        cpuMax=Path('/sys/fs/cgroup/cpu.max').read_text().strip(),
                        memoryMax=Path('/sys/fs/cgroup/memory.max').read_text().strip())


class ResidentHTTPServer(ThreadingHTTPServer):
    # Accept queued TCP connections for 32 VUs: up to 96 edge forwards plus
    # 32 result connections. This is not the hydraulic compute concurrency.
    request_queue_size = 128


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    # Headers and tiny acknowledgement bodies are written separately; avoid
    # Nagle waiting for a delayed ACK on the persistent HTTP connection.
    disable_nagle_algorithm = True

    def log_message(self, *_):
        pass

    def diagnose(self, error):
        """Error-only diagnostics: record the failing boundary, never payloads."""
        record = dict(event='HC_SERVICE_ERROR', at=time.time(), role=self.server.state.role,
                      method=getattr(self, 'command', None), path=urlsplit(getattr(self, 'path', '')).path,
                      peer=self.client_address, stage=getattr(self, 'stage', 'request_headers'),
                      exception=type(error).__name__, errno=getattr(error, 'errno', None),
                      traceback=''.join(traceback.format_exception(type(error), error, error.__traceback__)))
        if getattr(self, 'cloud_context', None):
            record['cloud'] = self.cloud_context
        print(json.dumps(record), file=sys.stderr, flush=True)

    def handle_one_request(self):
        self.stage = 'request_headers'
        self.cloud_context = None
        try:
            super().handle_one_request()
        except Exception as error:
            self.diagnose(error)
            raise

    def cloud_addresses(self):
        # getresponse() may itself clear HTTPConnection.sock after a reset, so
        # save established endpoints immediately after request(), before read.
        sock = getattr(getattr(self, 'cloud', None), 'sock', None)
        if sock is not None:
            for key, getter in (('local', sock.getsockname), ('peer', sock.getpeername)):
                try:
                    self.cloud_context[key] = getter()
                except OSError:
                    pass  # Preserve an earlier snapshot if the socket is broken.

    def forward_to_cloud(self, run, batch, payload, raw_bytes):
        state = self.server.state
        reused = hasattr(self, 'cloud') and self.cloud.sock is not None
        if not hasattr(self, 'cloud'):
            target = urlsplit(os.environ['CLOUD_URL'])
            self.cloud = HTTPConnection(target.hostname, target.port, timeout=30)
            self.cloud_successes = 0
        self.cloud_context = dict(reused=reused, successfulRequests=self.cloud_successes)
        self.cloud_addresses()
        try:
            self.stage = 'cloud_request'
            self.cloud.request('POST', f'/partial/{run}/{batch}', payload,
                               {'X-Group': state.role, 'X-Raw-Bytes': str(raw_bytes), 'Content-Type': 'application/octet-stream'})
            self.cloud_addresses()
            self.stage = 'cloud_response'
            response = self.cloud.getresponse()
            self.stage = 'cloud_read'
            response.read()
            if response.status != 200:
                # Do not copy a remote response body into diagnostics.
                raise ValueError(f'cloud status {response.status}')
            self.cloud_successes += 1
        except Exception:
            self.cloud_addresses()
            self.cloud.close()
            del self.cloud
            # This request remains failed. Only a subsequent request may open
            # a fresh connection; replaying an accepted partial could duplicate it.
            raise

    def reply(self, status, body=b'{}', content_type='application/json'):
        self.stage = 'reply'
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            self.stage = 'route'
            path = urlsplit(self.path).path
            if path == '/health':
                return self.reply(200)
            if path == '/stats':
                self.stage = 'stats'
                return self.reply(200, json.dumps(self.server.state.stats()).encode())
            _, endpoint, run, batch = path.split('/')
            if run != self.server.state.run or endpoint not in ('result', 'binary'):
                raise ValueError('wrong run or endpoint')
            self.stage = 'take_result'
            self.reply(200, self.server.state.take(batch, endpoint == 'binary'),
                       'application/octet-stream' if endpoint == 'binary' else 'application/json')
        except Exception as error:
            self.diagnose(error)
            if self.stage == 'reply':
                self.close_connection = True
                return
            self.reply(400, json.dumps({'error': str(error)}).encode())

    def do_POST(self):
        state = self.server.state
        try:
            self.stage = 'read_body'
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            self.stage = 'route'
            path = urlsplit(self.path).path
            if path == '/reset':
                self.stage = 'reset'
                state.reset(json.loads(body)['run'])
                return self.reply(200)
            _, endpoint, run, batch = path.split('/')
            if run != state.run:
                raise ValueError('wrong run')
            start = time.perf_counter()
            self.stage = 'decode'
            arrays = (decode_input(body) if endpoint == 'process' and self.headers.get('Content-Type') == CONTENT_TYPE
                      else unpack(body))
            decoded = time.perf_counter()
            if endpoint == 'partial' and state.role == 'cloud':
                self.stage = 'aggregate'
                state.add_part(batch, self.headers['X-Group'], arrays, int(self.headers['X-Raw-Bytes']))
            elif endpoint == 'process' and state.role in GROUPS:
                raw_bytes = sum(arrays[k].nbytes for k in GROUPS[state.role])
                self.stage = 'compute_queue'
                with state.compute:
                    admitted = time.perf_counter()
                    self.stage = 'compute'
                    result = edge(arrays, state.role)
                    computed = time.perf_counter()
                self.stage = 'encode'
                payload = pack(result)
                # edge() passes cycle_ids through. Drop that view as well as the
                # input views/body before waiting on the cloud's small result.
                del result, arrays, body
                encoded = time.perf_counter()
                # Reuse one connection per inbound persistent HTTP handler/thread.
                self.forward_to_cloud(run, batch, payload, raw_bytes)
                self.stage = 'accounting'
                with state.lock:
                    state.completed += 1
                    state.raw_bytes += raw_bytes
                    for name, duration in dict(queue=admitted-decoded, compute=computed-admitted,
                                               encode=encoded-computed, forward=time.perf_counter()-encoded).items():
                        state.stage_seconds[name] += duration
            else:
                raise ValueError('wrong role or endpoint')
            with state.lock:
                state.stage_seconds['decode'] += decoded-start
            self.reply(200)
        except Exception as error:
            self.diagnose(error)
            with state.lock:
                state.errors += 1
            if self.stage == 'reply':
                self.close_connection = True
                return
            self.reply(400, json.dumps({'error': str(error)}).encode())

    def finish(self):
        if hasattr(self, 'cloud'):
            self.cloud.close()
        super().finish()


def main():
    role = os.environ['ROLE']
    state = State(role, load('/reference/reference.npz') if role == 'cloud' else None)
    def sample():
        while True:
            time.sleep(.25)
            with state.lock:
                if state.run:
                    state.samples.append(counters())
    threading.Thread(target=sample, daemon=True).start()
    server = ResidentHTTPServer(('0.0.0.0', 8080), Handler)
    server.daemon_threads = True
    server.state = state
    print(json.dumps({'ready': role, 'limits': state.stats()['cpuMax']}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()

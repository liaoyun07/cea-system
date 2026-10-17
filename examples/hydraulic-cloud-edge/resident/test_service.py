import contextlib
import io
import json
import socket
import struct
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest import mock
import numpy as np
from app import GROUPS, fuse
from service import Handler, ResidentHTTPServer, State, pack, unpack, reference_for


class ResidentTest(unittest.TestCase):
    def setUp(self):
        self.ids = np.array([0, 1])
        self.reference = dict(cycle_ids=np.arange(3), center=np.ones((6,17,5)),
                              scale=np.ones((6,17,5)), calibration_ids=np.array([0]),
                              stable=np.ones(3, dtype=bool), healthy=np.ones(3, dtype=bool), unique_cycles=np.array(3))
        self.state = State('cloud', self.reference)

    def part(self, group):
        return dict(cycle_ids=self.ids, **{k: np.ones((2,6,5)) for k in GROUPS[group]})

    def test_waits_for_three_actual_parts_and_counts_once(self):
        for i, group in enumerate(GROUPS):
            self.state.add_part('a', group, self.part(group), 10)
            self.assertEqual(self.state.completed, int(i == 2))
        self.assertEqual(self.state.raw_bytes, 30)
        self.assertEqual(len(unpack(self.state.take('a', True))['cycle_ids']), 2)
        self.assertEqual(len(self.state.results), 0)
        with self.assertRaises(KeyError):
            self.state.take('a')

    def test_duplicate_part_rejected(self):
        self.state.add_part('a', 'edge-a', self.part('edge-a'), 10)
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.state.add_part('a', 'edge-a', self.part('edge-a'), 10)

    def test_unknown_cycle_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unknown'):
            reference_for(self.reference, np.array([9]))

    def test_mismatched_cycles_not_completed(self):
        self.state.add_part('a', 'edge-a', self.part('edge-a'), 10)
        self.state.add_part('a', 'edge-b', self.part('edge-b'), 10)
        part = self.part('edge-c'); part['cycle_ids'] = np.array([1, 0])
        with self.assertRaises(ValueError):
            self.state.add_part('a', 'edge-c', part, 10)
        self.assertEqual(self.state.completed, 0)

    def test_binary_round_trip(self):
        part = self.part('edge-a')
        actual = unpack(pack(part))
        for key in part:
            np.testing.assert_array_equal(actual[key], part[key])

    def test_receiving_and_reading_other_batches_do_not_wait_for_fusion(self):
        for group in GROUPS:
            self.state.add_part('finished', group, self.part(group), 10)
        for group in ('edge-a', 'edge-b'):
            self.state.add_part('computing', group, self.part(group), 10)
        entered, release = threading.Event(), threading.Event()

        def blocked_fuse(*args):
            entered.set()
            self.assertTrue(release.wait(5), 'test did not release fusion')
            return fuse(*args)

        with mock.patch('service.fuse', side_effect=blocked_fuse), ThreadPoolExecutor(3) as pool:
            computing = pool.submit(self.state.add_part, 'computing', 'edge-c', self.part('edge-c'), 10)
            try:
                self.assertTrue(entered.wait(2))
                receiving = pool.submit(self.state.add_part, 'next', 'edge-a', self.part('edge-a'), 10)
                receiving.result(timeout=2)
                result = json.loads(pool.submit(self.state.take, 'finished').result(timeout=2))
                self.assertEqual(result['inputBytes'], 30)
                self.assertFalse(computing.done())
                self.assertEqual(len(self.state.parts['computing']), 3)
                with self.assertRaisesRegex(ValueError, 'duplicate'):
                    self.state.add_part('computing', 'edge-c', self.part('edge-c'), 10)
                with self.assertRaisesRegex(ValueError, 'unconsumed'):
                    self.state.reset('new-run')
                with self.assertRaises(KeyError):
                    self.state.take('computing')
            finally:
                release.set()
            computing.result(timeout=2)
        self.assertEqual(self.state.completed, 2)
        self.assertNotIn('computing', self.state.parts)
        self.assertEqual(json.loads(self.state.take('computing'))['cycles'], 2)

    def test_compute_wait_does_not_hold_state_lock_and_fusion_stays_serial(self):
        entered, release, queued = threading.Event(), threading.Event(), threading.Event()
        actual_semaphore = threading.Semaphore(1)

        class ObservedSemaphore:
            def __enter__(self):
                if entered.is_set():
                    queued.set()
                actual_semaphore.acquire()

            def __exit__(self, *_):
                actual_semaphore.release()

        self.state.compute = ObservedSemaphore()
        calls = []

        def blocked_first(*args):
            calls.append(1)
            if len(calls) == 1:
                entered.set()
                self.assertTrue(release.wait(5))
            return fuse(*args)

        for batch in ('first', 'second'):
            for group in ('edge-a', 'edge-b'):
                self.state.add_part(batch, group, self.part(group), 10)
        with mock.patch('service.fuse', side_effect=blocked_first), ThreadPoolExecutor(3) as pool:
            first = pool.submit(self.state.add_part, 'first', 'edge-c', self.part('edge-c'), 10)
            try:
                self.assertTrue(entered.wait(2))
                second = pool.submit(self.state.add_part, 'second', 'edge-c', self.part('edge-c'), 10)
                self.assertTrue(queued.wait(2))
                pool.submit(self.state.add_part, 'third', 'edge-a', self.part('edge-a'), 10).result(timeout=2)
                self.assertEqual(len(calls), 1)
                self.assertFalse(second.done())
            finally:
                release.set()
            first.result(timeout=2)
            second.result(timeout=2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.state.completed, 2)
        self.assertGreater(self.state.stage_seconds['queue'], 0)

    def test_simultaneous_final_parts_compute_each_batch_exactly_once(self):
        for batch in range(20):
            self.state.add_part(str(batch), 'edge-a', self.part('edge-a'), 10)
        ready = threading.Barrier(40)

        def send(pair):
            batch, group = pair
            ready.wait(timeout=5)
            self.state.add_part(str(batch), group, self.part(group), 10)

        with mock.patch('service.fuse', wraps=fuse) as fusion, ThreadPoolExecutor(40) as pool:
            list(pool.map(send, [(batch, group) for batch in range(20) for group in ('edge-b', 'edge-c')]))
        self.assertEqual(fusion.call_count, 20)
        self.assertEqual(self.state.completed, 20)
        self.assertEqual(self.state.raw_bytes, 600)
        self.assertEqual(self.state.parts, {})
        for batch in range(20):
            self.assertEqual(json.loads(self.state.take(str(batch)))['inputBytes'], 30)

    def test_fusion_failure_retains_evidence_and_releases_compute_slot(self):
        for group in ('edge-a', 'edge-b'):
            self.state.add_part('bad', group, self.part(group), 10)
        with mock.patch('service.fuse', side_effect=ValueError('bad fusion')):
            with self.assertRaisesRegex(ValueError, 'bad fusion'):
                self.state.add_part('bad', 'edge-c', self.part('edge-c'), 10)
        self.assertEqual(self.state.completed, 0)
        self.assertEqual(len(self.state.parts['bad']), 3)
        self.assertNotIn('bad', self.state.results)
        with self.assertRaisesRegex(ValueError, 'unconsumed'):
            self.state.reset('new-run')
        for group in GROUPS:
            self.state.add_part('good', group, self.part(group), 10)
        self.assertEqual(self.state.completed, 1)
        self.assertEqual(json.loads(self.state.take('good'))['inputBytes'], 30)


class ConnectionTest(unittest.TestCase):
    def handler(self):
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(state=State('edge-a'))
        handler.client_address = ('127.0.0.1', 1234)
        handler.path = '/process/test/1'
        handler.command = 'POST'
        return handler

    def test_each_forward_failure_discards_connection_without_retry(self):
        for boundary in ('request', 'getresponse', 'read'):
            with self.subTest(boundary=boundary):
                connection = mock.Mock(sock=None)
                connection.getresponse.return_value.status = 200
                failing = connection.getresponse.return_value.read if boundary == 'read' else getattr(connection, boundary)
                failing.side_effect = ConnectionResetError(104, 'Connection reset by peer')
                handler = self.handler()
                with mock.patch.dict('os.environ', {'CLOUD_URL': 'http://cloud:8080'}), \
                     mock.patch('service.HTTPConnection', return_value=connection) as factory:
                    with self.assertRaises(ConnectionResetError):
                        handler.forward_to_cloud('test', '1', b'private-payload', 15)
                factory.assert_called_once()
                connection.request.assert_called_once()
                connection.close.assert_called_once()
                self.assertFalse(hasattr(handler, 'cloud'))
                self.assertEqual(handler.stage, {'request': 'cloud_request', 'getresponse': 'cloud_response', 'read': 'cloud_read'}[boundary])
                log = io.StringIO()
                try:
                    raise ConnectionResetError(104, 'Connection reset by peer')
                except ConnectionResetError as error:
                    with contextlib.redirect_stderr(log):
                        handler.diagnose(error)
                event = json.loads(log.getvalue())
                self.assertEqual(event['role'], 'edge-a')
                self.assertEqual(event['peer'], ['127.0.0.1', 1234])
                self.assertEqual(event['exception'], 'ConnectionResetError')
                self.assertIn('ConnectionResetError', event['traceback'])
                self.assertNotIn('private-payload', log.getvalue())

    def test_remote_error_body_is_not_logged_and_connection_is_discarded(self):
        connection = mock.Mock(sock=None)
        connection.getresponse.return_value.status = 500
        connection.getresponse.return_value.read.return_value = b'sensitive-remote-body'
        handler = self.handler()
        with mock.patch.dict('os.environ', {'CLOUD_URL': 'http://cloud:8080'}), \
             mock.patch('service.HTTPConnection', return_value=connection):
            with self.assertRaisesRegex(ValueError, '^cloud status 500$'):
                handler.forward_to_cloud('test', '1', b'private-payload', 15)
        connection.close.assert_called_once()
        self.assertFalse(hasattr(handler, 'cloud'))

    def test_real_reset_fails_original_request_but_next_request_gets_fresh_connection(self):
        received = []

        class ResetOnce(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                received.append(self.path)
                if len(received) == 1:
                    # A real peer-originated TCP RST after accepting the body.
                    self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
                    self.close_connection = True
                    # Close before HTTPServer.shutdown_request sends a FIN;
                    # otherwise this fixture would reproduce EOF, not RST.
                    self.rfile.close()
                    self.wfile.close()
                    self.connection.close()
                    return
                self.send_response(200)
                self.send_header('Content-Length', '2')
                self.end_headers()
                self.wfile.write(b'{}')

        cloud = ThreadingHTTPServer(('127.0.0.1', 0), ResetOnce)
        edge_server = ResidentHTTPServer(('127.0.0.1', 0), Handler)
        edge_server.state = State('edge-a')
        edge_server.state.run = 'test'
        for server in (cloud, edge_server):
            server.daemon_threads = True
            threading.Thread(target=server.serve_forever, daemon=True).start()
        connection = HTTPConnection('127.0.0.1', edge_server.server_port, timeout=5)
        arrays = dict(cycle_ids=np.array([0]), **{name: np.ones((1, 6000), dtype=np.float32) for name in GROUPS['edge-a']})
        body = pack(arrays)
        log = io.StringIO()
        try:
            with mock.patch.dict('os.environ', {'CLOUD_URL': f'http://127.0.0.1:{cloud.server_port}'}), \
                 mock.patch('service.edge', return_value=dict(cycle_ids=np.array([0]))), \
                 contextlib.redirect_stderr(log):
                connection.request('POST', '/process/test/first', body)
                response = connection.getresponse()
                first = json.loads(response.read())
                self.assertEqual(response.status, 400)
                self.assertIn('reset', first['error'].lower())
                connection.request('POST', '/process/test/next', body)
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, 200)
                connection.close()
            self.assertEqual(received, ['/partial/test/first', '/partial/test/next'])
            self.assertEqual(edge_server.state.completed, 1)
            self.assertEqual(edge_server.state.errors, 1)
            events = [json.loads(line) for line in log.getvalue().splitlines() if line.startswith('{')]
            event = next(event for event in events if event['path'] == '/process/test/first')
            self.assertEqual(event['stage'], 'cloud_response')
            self.assertEqual(event['exception'], 'ConnectionResetError')
            self.assertFalse(event['cloud']['reused'])
            self.assertEqual(event['cloud']['successfulRequests'], 0)
            self.assertEqual(event['cloud']['peer'], ['127.0.0.1', cloud.server_port])
            self.assertIn('local', event['cloud'])
        finally:
            connection.close()
            for server in (edge_server, cloud):
                server.shutdown()
                server.server_close()

    def test_server_listens_with_128_pending_connection_backlog(self):
        server = object.__new__(ResidentHTTPServer)
        server.socket = mock.Mock()
        server.server_activate()
        server.socket.listen.assert_called_once_with(128)

    def test_32_real_persistent_connections_have_nodelay_and_transfer_complete_batches(self):
        socket_options = []
        options_lock = threading.Lock()

        class InspectingHandler(Handler):
            def setup(self):
                super().setup()
                with options_lock:
                    socket_options.append(self.connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY))

        reference = dict(cycle_ids=np.arange(3), center=np.ones((6, 17, 5)),
                         scale=np.ones((6, 17, 5)), calibration_ids=np.array([0]),
                         stable=np.ones(3, dtype=bool), healthy=np.ones(3, dtype=bool), unique_cycles=np.array(3))
        server = ResidentHTTPServer(('127.0.0.1', 0), InspectingHandler)
        server.state = State('cloud', reference)
        server.state.run = 'parallel'
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        payloads = {group: pack(dict(cycle_ids=np.array([0, 1]), **{name: np.ones((2, 6, 5)) for name in channels}))
                    for group, channels in GROUPS.items()}
        ready = threading.Barrier(32)

        def transfer(batch):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            try:
                ready.wait(timeout=5)
                for group, payload in payloads.items():
                    connection.request('POST', f'/partial/parallel/{batch}', payload,
                                       {'X-Group': group, 'X-Raw-Bytes': '10'})
                    response = connection.getresponse()
                    body = response.read()
                    self.assertEqual(response.status, 200, body)
                connection.request('GET', f'/result/parallel/{batch}')
                response = connection.getresponse()
                result = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(result, dict(inputBytes=30, cycles=2, scoreSum=0., flagCount=0))
            finally:
                connection.close()

        try:
            with ThreadPoolExecutor(max_workers=32) as pool:
                list(pool.map(transfer, range(32)))
            self.assertEqual(socket_options, [1] * 32)
            self.assertEqual(server.state.completed, 32)
            self.assertEqual(server.state.raw_bytes, 960)
            self.assertEqual(server.state.errors, 0)
            self.assertEqual(server.state.parts, {})
            self.assertEqual(server.state.results, {})
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()

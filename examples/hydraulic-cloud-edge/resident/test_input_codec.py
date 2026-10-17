import contextlib
import io
import json
import struct
import tempfile
import threading
import unittest
import weakref
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np

from app import GROUPS, RATES, edge, fuse, load
from fixtures import prepare, request
from input_codec import CONTENT_TYPE, decode_input, encode_input
from service import Handler, ResidentHTTPServer, State, pack, unpack


def inputs(group, cycles=2):
    return dict(cycle_ids=np.arange(cycles, dtype=np.int64),
                **{name: (np.arange(cycles * 60 * RATES[name], dtype=np.float32)
                          .reshape(cycles, -1) * .125 + 70) for name in GROUPS[group]})


def reference(cycles=2):
    return dict(cycle_ids=np.arange(cycles, dtype=np.int64), center=np.ones((6, 17, 5)),
                scale=np.ones((6, 17, 5)), calibration_ids=np.array([0]),
                stable=np.ones(cycles, dtype=bool), healthy=np.ones(cycles, dtype=bool),
                unique_cycles=np.array(cycles))


class InputCodecTest(unittest.TestCase):
    def test_preserves_shape_dtype_and_every_bit(self):
        # Include signed zero and NaN payload bits: the codec must not convert values.
        bits = np.array([0x80000000, 0x7fc00001, 0x3f800000, 0x7f800000], dtype=np.uint32)
        original = dict(cycle_ids=np.array([0, 2**60], dtype=np.int64), PS1=bits.view(np.float32).reshape(2, 2))
        actual = decode_input(encode_input(original))
        self.assertEqual(actual.keys(), original.keys())
        for name, array in original.items():
            self.assertEqual(actual[name].shape, array.shape)
            self.assertEqual(actual[name].dtype, array.dtype)
            self.assertEqual(actual[name].tobytes(), array.tobytes())

    def test_views_share_body_are_readonly_aligned_and_contiguous(self):
        original = dict(short=np.arange(3, dtype=np.float32), cycle_ids=np.arange(3, dtype=np.int64))
        body = encode_input(original)
        raw = np.frombuffer(body, dtype=np.uint8)
        arrays = decode_input(body)
        for array in arrays.values():
            self.assertTrue(np.shares_memory(array, raw))
            self.assertEqual((array.ctypes.data - raw.ctypes.data) % 8, 0)
            self.assertTrue(array.flags.aligned)
            self.assertTrue(array.flags.c_contiguous)
            self.assertFalse(array.flags.writeable)
            self.assertFalse(array.flags.owndata)
            with self.assertRaises(ValueError):
                array.flat[0] = 9
        del body, raw
        np.testing.assert_array_equal(arrays['cycle_ids'], original['cycle_ids'])

    def test_noncontiguous_fixture_serializes_in_original_c_order(self):
        array = np.arange(30, dtype=np.float32).reshape(3, 10)[:, ::2]
        self.assertFalse(array.flags.c_contiguous)
        actual = decode_input(encode_input({'PS1': array}))['PS1']
        self.assertEqual(actual.tobytes(), array.tobytes())
        self.assertTrue(actual.flags.c_contiguous)

    def test_rejects_truncated_header_data_extra_bytes_and_mutable_body(self):
        body = encode_input({'cycle_ids': np.arange(2, dtype=np.int64)})
        for broken in (b'', body[:3], struct.pack('<I', len(body)), body[:-1], body + b'x', bytearray(body)):
            with self.subTest(size=len(broken)), self.assertRaises(ValueError):
                decode_input(broken)

    def test_rejects_invalid_array_directory(self):
        directories = [None, {}, [], [['x', '<f4']], [['x', '<f8', [1]]],
                       [['x', '<f4', []]], [['x', '<f4', [0]]], [['x', '<f4', [-1]]],
                       [['x', '<f4', [1.5]]], [['x', '<f4', [True]]], [['', '<f4', [1]]],
                       [['x', '<f4', [1, 1, 1]]], [['x', '<f4', [1]], ['x', '<f4', [1]]]]
        for directory in directories:
            header = json.dumps(directory).encode()
            body = struct.pack('<I', len(header)) + header
            body += b'\0' * ((-len(body)) % 8) + b'\0' * 16
            with self.subTest(directory=directory), self.assertRaises(ValueError):
                decode_input(body)

    def test_encoder_rejects_non_input_dtypes_and_shapes(self):
        for array in (np.ones(1, dtype=np.float64), np.ones(1, dtype='>f4'), np.array(['x']),
                      np.array([object()]), np.array(1, dtype=np.int64), np.ones((0, 2), dtype=np.float32)):
            with self.subTest(dtype=array.dtype, shape=array.shape), self.assertRaises(ValueError):
                encode_input({'x': array})
        with self.assertRaises(ValueError):
            encode_input({})

    def test_small_directory_limit_applies_to_encoder_and_decoder(self):
        with self.assertRaisesRegex(ValueError, '4096'):
            encode_input({'x' * 4096: np.ones(1, dtype=np.float32)})
        with self.assertRaisesRegex(ValueError, '4096'):
            decode_input(struct.pack('<I', 4097) + b' ' * 4097)

    def test_original_edge_and_fusion_outputs_are_identical(self):
        npz_parts, view_parts = [], []
        for group in GROUPS:
            source = inputs(group)
            npz_part = edge(unpack(pack(source)), group)
            view_part = edge(decode_input(encode_input(source)), group)
            for name in npz_part:
                self.assertEqual(npz_part[name].tobytes(), view_part[name].tobytes())
            npz_parts.append(npz_part)
            view_parts.append(view_part)
        expected, expected_metrics = fuse(npz_parts, reference(), 3.)
        actual, actual_metrics = fuse(view_parts, reference(), 3.)
        self.assertEqual(actual_metrics, expected_metrics)
        for name in expected:
            self.assertEqual(actual[name].tobytes(), expected[name].tobytes())


class FixtureTest(unittest.TestCase):
    def test_128_cycle_batches_preserve_all_inputs_and_reference_outputs(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            groups = {group: inputs(group, 157) for group in GROUPS}
            for group, arrays in groups.items():
                np.savez(source / f'{group}.npz', **arrays)
            np.savez(source / 'reference.npz', **reference(157))
            prepare(source, root / 'small', 'arrays')
            prepare(source, root / 'large', 'arrays', 128)
            small = json.loads((root / 'small/manifest.json').read_text())
            large = json.loads((root / 'large/manifest.json').read_text())
            self.assertEqual([item['expected']['cycles'] for item in large], [128, 29])
            self.assertEqual(sum(x['expected']['inputBytes'] for x in small),
                             sum(x['expected']['inputBytes'] for x in large))
            for group_index, group in enumerate(GROUPS):
                decoded = [decode_input((root / 'large' / item['files'][group_index]['name']).read_bytes())
                           for item in large]
                for key in groups[group]:
                    np.testing.assert_array_equal(np.concatenate([x[key] for x in decoded]), groups[group][key])
            old = [load(root / 'small' / f'{i}-expected.npz') for i in range(len(small))]
            new = [load(root / 'large' / f'{i}-expected.npz') for i in range(len(large))]
            for key in old[0]:
                np.testing.assert_array_equal(np.concatenate([x[key] for x in old]),
                                              np.concatenate([x[key] for x in new]))
            with self.assertRaises(ValueError):
                prepare(source, root / 'invalid', 'arrays', 0)

    def test_optional_arrays_fixtures_keep_original_bytes_batches_and_npz_results(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            groups = {group: inputs(group, 65) for group in GROUPS}
            for group, arrays in groups.items():
                np.savez(source / f'{group}.npz', **arrays)
            np.savez(source / 'reference.npz', **reference(65))
            prepare(source, root / 'npz')  # Existing callers retain the default.
            prepare(source, root / 'arrays', 'arrays')
            legacy = json.loads((root / 'npz' / 'manifest.json').read_text())
            views = json.loads((root / 'arrays' / 'manifest.json').read_text())
            self.assertEqual(len(views), 2)
            self.assertEqual([item['expected']['cycles'] for item in views], [64, 1])
            for index, (old, new) in enumerate(zip(legacy, views)):
                self.assertEqual(old['expected'], new['expected'])
                for group, old_file, new_file in zip(GROUPS, old['files'], new['files']):
                    self.assertNotIn('contentType', old_file)
                    self.assertEqual(new_file['contentType'], CONTENT_TYPE)
                    self.assertTrue(new_file['name'].endswith('.arrays'))
                    body = (root / 'arrays' / new_file['name']).read_bytes()
                    self.assertEqual(len(body), new_file['length'])
                    decoded = decode_input(body)
                    original = unpack((root / 'npz' / old_file['name']).read_bytes())
                    for name in original:
                        self.assertEqual(decoded[name].tobytes(), original[name].tobytes())
                        self.assertEqual(decoded[name].tobytes(), groups[group][name][index*64:index*64+64].tobytes())
                old_expected = load(root / 'npz' / f'{index}-expected.npz')
                new_expected = load(root / 'arrays' / f'{index}-expected.npz')
                for name in old_expected:
                    self.assertEqual(new_expected[name].tobytes(), old_expected[name].tobytes())

    def test_verify_request_sends_manifest_content_type(self):
        with mock.patch('fixtures.urllib.request.urlopen') as urlopen:
            urlopen.return_value.read.return_value = b'{}'
            request('http://localhost/process/test/0', b'body', CONTENT_TYPE)
            actual = urlopen.call_args.args[0]
            self.assertEqual(actual.get_header('Content-type'), CONTENT_TYPE)
            self.assertEqual(actual.data, b'body')


class InputServiceTest(unittest.TestCase):
    def handler(self, body, content_type=CONTENT_TYPE, role='edge-a', path='/process/test/0'):
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(state=State(role, reference() if role == 'cloud' else None))
        handler.server.state.run = 'test'
        handler.client_address = ('127.0.0.1', 1234)
        handler.path, handler.command = path, 'POST'
        handler.headers = {'Content-Length': str(len(body)), 'Content-Type': content_type}
        handler.rfile = io.BytesIO(body)
        handler.reply, handler.forward_to_cloud = mock.Mock(), mock.Mock()
        return handler

    def test_process_drops_body_and_all_views_before_forward(self):
        released, views = [], []

        class TrackedBytes(bytes):
            def __del__(self):
                released.append(True)

        body = encode_input(inputs('edge-a'))
        handler = self.handler(body)
        # read() owns the only TrackedBytes reference. Merely dropping `body`
        # is insufficient: arrays and result['cycle_ids'] also retain it.
        handler.rfile = SimpleNamespace(read=lambda _: TrackedBytes(body))

        def decode(value):
            arrays = decode_input(value)
            views.extend(weakref.ref(array) for array in arrays.values())
            return arrays

        def forward(run, batch, payload, raw_bytes):
            self.assertEqual(released, [True])
            self.assertTrue(all(view() is None for view in views))
            actual = unpack(payload)
            expected = edge(inputs('edge-a'), 'edge-a')
            for name in actual:
                np.testing.assert_array_equal(actual[name], expected[name])
            self.assertEqual(raw_bytes, 2 * 3 * 6000 * 4)

        handler.forward_to_cloud.side_effect = forward
        # Use the function directly: a Mock would keep its body argument alive
        # in call_args and invalidate the lifetime assertion itself.
        with mock.patch('service.decode_input', new=decode):
            handler.do_POST()
        handler.reply.assert_called_once_with(200)
        handler.forward_to_cloud.assert_called_once()
        self.assertEqual(handler.server.state.completed, 1)

    def test_malformed_arrays_fail_without_forward_and_partial_stays_npz(self):
        body = encode_input(inputs('edge-a'))
        for handler in (self.handler(body[:-1]), self.handler(body, role='cloud', path='/partial/test/0')):
            with self.subTest(path=handler.path), contextlib.redirect_stderr(io.StringIO()):
                handler.do_POST()
                self.assertEqual(handler.reply.call_args.args[0], 400)
                handler.forward_to_cloud.assert_not_called()
                self.assertEqual(handler.server.state.completed, 0)
                self.assertEqual(handler.server.state.errors, 1)

    def test_real_three_edge_cloud_chain_accepts_both_inputs_and_returns_same_npz(self):
        servers = {}
        for role in ('cloud', *GROUPS):
            server = ResidentHTTPServer(('127.0.0.1', 0), Handler)
            server.daemon_threads = True
            server.state = State(role, reference() if role == 'cloud' else None)
            server.state.run = 'test'
            servers[role] = server
            threading.Thread(target=server.serve_forever, daemon=True).start()
        source = {group: inputs(group) for group in GROUPS}
        expected, _ = fuse([edge(source[group], group) for group in GROUPS], reference(), 3.)
        total_bytes = sum(source[group][name].nbytes for group in GROUPS for name in GROUPS[group])

        def send(group, batch, encoder, content_type):
            connection = HTTPConnection('127.0.0.1', servers[group].server_port, timeout=5)
            try:
                connection.request('POST', f'/process/test/{batch}', encoder(source[group]), {'Content-Type': content_type})
                response = connection.getresponse()
                self.assertEqual(response.status, 200, response.read())
            finally:
                connection.close()

        connection = HTTPConnection('127.0.0.1', servers['cloud'].server_port, timeout=5)
        try:
            with mock.patch.dict('os.environ', {'CLOUD_URL': f"http://127.0.0.1:{servers['cloud'].server_port}"}), \
                 ThreadPoolExecutor(max_workers=3) as pool:
                for batch, encoder, content_type in (('npz', pack, 'application/octet-stream'),
                                                      ('arrays', encode_input, CONTENT_TYPE)):
                    list(pool.map(lambda group: send(group, batch, encoder, content_type), GROUPS))
                    connection.request('GET', f'/binary/test/{batch}')
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.getheader('Content-Type'), 'application/octet-stream')
                    actual = unpack(response.read())
                    self.assertEqual(actual.keys(), expected.keys())
                    for name in actual:
                        self.assertEqual(actual[name].tobytes(), expected[name].tobytes())
            self.assertEqual(servers['cloud'].state.raw_bytes, 2 * total_bytes)
            for server in servers.values():
                self.assertEqual(server.state.completed, 2)
                self.assertEqual(server.state.errors, 0)
                self.assertEqual(server.state.parts, {})
                self.assertEqual(server.state.results, {})
        finally:
            connection.close()
            for server in servers.values():
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()

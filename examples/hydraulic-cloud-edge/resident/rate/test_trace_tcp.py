import struct
import unittest

from trace_tcp import header_filter, parse_frame


def packet(flags=0x14, ip_options=0, tcp_options=0, payload=b'PRIVATE_PAYLOAD'):
    ihl, thl = 20 + ip_options, 20 + tcp_options
    frame = bytearray(14 + ihl + thl + len(payload))
    frame[12:14] = b'\x08\x00'
    frame[14] = 0x40 | (ihl // 4)
    struct.pack_into('!H', frame, 16, ihl + thl + len(payload))
    frame[23] = 6
    frame[26:30], frame[30:34] = b'\x0a\x00\x00\x01', b'\x0a\x00\x00\x02'
    tcp = 14 + ihl
    struct.pack_into('!HHII', frame, tcp, 8080, 43100, 123, 456)
    frame[tcp + 12], frame[tcp + 13] = (thl // 4) << 4, flags
    frame[tcp + thl:] = payload
    return frame


def filter_length(frame):
    """Evaluate only the cBPF opcodes used by the actual header-only filter."""
    a = x = pc = 0
    program = header_filter()
    while True:
        code, jt, jf, k = program[pc]
        if code == 0x30:
            a = frame[k]
        elif code == 0x28:
            a = struct.unpack_from('!H', frame, k)[0]
        elif code == 0x15:
            pc += jt if a == k else jf
        elif code == 0x45:
            pc += jt if a & k else jf
        elif code == 0xb1:
            x = (frame[k] & 15) * 4
        elif code == 0x50:
            a = frame[x + k]
        elif code == 0x54:
            a &= k
        elif code == 0x74:
            a >>= k
        elif code == 0x35:
            pc += jt if a >= k else jf
        elif code == 0x0c:
            a += x
        elif code == 0x04:
            a += k
        elif code == 0x16:
            return a
        elif code == 0x06:
            return k
        else:
            raise AssertionError(code)
        pc += 1


class TcpHeaderTraceTest(unittest.TestCase):
    def test_rst_headers_and_tuple_without_body(self):
        frame = packet()
        size = filter_length(frame)
        self.assertEqual(size, 54)
        self.assertNotIn(b'PRIVATE_PAYLOAD', frame[:size])
        result = parse_frame(frame[:size], {8080})
        self.assertEqual(result['flags'], ['RST', 'ACK'])
        self.assertEqual((result['sourceIp'], result['sourcePort']), ('10.0.0.1', 8080))
        self.assertEqual((result['seq'], result['ack']), (123, 456))
        self.assertEqual(result['payloadLength'], len(b'PRIVATE_PAYLOAD'))

    def test_options_are_in_header_but_payload_is_not(self):
        frame = packet(flags=2, ip_options=12, tcp_options=20)
        size = filter_length(frame)
        self.assertEqual(size, 86)
        self.assertEqual(parse_frame(frame[:size], {43100})['flags'], ['SYN'])
        self.assertNotIn(b'PRIVATE_PAYLOAD', frame[:size])

    def test_fin_is_captured(self):
        frame = packet(flags=0x11)
        self.assertEqual(parse_frame(frame[:filter_length(frame)], {8080})['flags'], ['FIN', 'ACK'])

    def test_ack_data_is_discarded_in_kernel_filter(self):
        self.assertEqual(filter_length(packet(flags=0x18)), 0)

    def test_non_tcp_and_non_first_fragments_are_discarded(self):
        frame = packet()
        frame[12:14] = b'\x08\x06'
        self.assertEqual(filter_length(frame), 0)
        frame = packet()
        frame[23] = 17
        self.assertEqual(filter_length(frame), 0)
        frame = packet()
        struct.pack_into('!H', frame, 20, 1)
        self.assertEqual(filter_length(frame), 0)

    def test_unrelated_port_and_short_headers_are_not_reported(self):
        self.assertIsNone(parse_frame(packet(), {31095}))
        self.assertIsNone(parse_frame(packet()[:40], {8080}))


if __name__ == '__main__':
    unittest.main()

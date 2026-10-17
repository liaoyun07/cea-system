"""Short-lived Pod-local TCP control-header observer; never emits packet bodies.

Run separately from the service, with existing CAP_NET_RAW only:
  python trace_tcp.py --interface eth0 --duration 40 --port 8080 --port 31095
The kernel filter copies only IPv4 TCP SYN/FIN/RST headers to this process.
Timestamps are userspace observation times, not kernel arrival timestamps.
"""
import argparse
import ctypes
import json
import signal
import socket
import struct
import time
from pathlib import Path


def header_filter():
    # Ethernet + IPv4 only. X is the IPv4 header length; TCP flags are X+27.
    # Return Ethernet + actual IPv4/TCP header lengths, excluding any payload.
    return [
        (0x28, 0, 0, 12),       # LD H ABS: Ethernet type
        (0x15, 0, 14, 0x0800),  # IPv4 only
        (0x30, 0, 0, 23),       # LD B ABS: IP protocol
        (0x15, 0, 12, 6),       # JEQ TCP, otherwise reject
        (0x28, 0, 0, 20),       # LD H ABS: fragment flags/offset
        (0x45, 10, 0, 0x1fff),  # Reject non-first fragments
        (0xb1, 0, 0, 14),       # LDX B MSH: IPv4 IHL * 4
        (0x50, 0, 0, 27),       # LD B IND: TCP flags
        (0x45, 0, 7, 0x07),     # SYN | FIN | RST, otherwise reject
        (0x50, 0, 0, 26),       # LD B IND: TCP data offset
        (0x54, 0, 0, 0xf0),     # AND K
        (0x74, 0, 0, 2),        # RSH K: TCP header length in bytes
        (0x35, 0, 3, 20),       # Reject invalid short TCP header
        (0x0c, 0, 0, 0),        # ADD X: IPv4 header length
        (0x04, 0, 0, 14),       # ADD K: Ethernet header
        (0x16, 0, 0, 0),        # RET A: copy headers only
        (0x06, 0, 0, 0),        # RET K: reject
    ]


def attach_filter(sock):
    class SockFilter(ctypes.Structure):
        _fields_ = [('code', ctypes.c_ushort), ('jt', ctypes.c_ubyte),
                    ('jf', ctypes.c_ubyte), ('k', ctypes.c_uint32)]

    class SockFprog(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ushort), ('filters', ctypes.POINTER(SockFilter))]

    instructions = header_filter()
    program = (SockFilter * len(instructions))(*(SockFilter(*row) for row in instructions))
    descriptor = SockFprog(len(instructions), program)
    libc = ctypes.CDLL(None, use_errno=True)
    # Linux SO_ATTACH_FILTER. The kernel copies the program during this call.
    if libc.setsockopt(sock.fileno(), socket.SOL_SOCKET, 26,
                       ctypes.byref(descriptor), ctypes.sizeof(descriptor)) != 0:
        raise OSError(ctypes.get_errno(), 'SO_ATTACH_FILTER failed')


def parse_frame(frame, ports):
    if len(frame) < 54 or frame[12:14] != b'\x08\x00' or frame[14] >> 4 != 4:
        return None
    ihl = (frame[14] & 15) * 4
    if ihl < 20 or frame[23] != 6 or struct.unpack_from('!H', frame, 20)[0] & 0x1fff:
        return None
    offset = 14 + ihl
    if len(frame) < offset + 20:
        return None
    source, destination, seq, ack = struct.unpack_from('!HHII', frame, offset)
    tcp_length = (frame[offset + 12] >> 4) * 4
    flags = frame[offset + 13]
    if tcp_length < 20 or len(frame) < offset + tcp_length or not flags & 7:
        return None
    if source not in ports and destination not in ports:
        return None
    total = struct.unpack_from('!H', frame, 16)[0]
    if total < ihl + tcp_length:
        return None
    return dict(sourceIp=socket.inet_ntoa(frame[26:30]), sourcePort=source,
                destinationIp=socket.inet_ntoa(frame[30:34]), destinationPort=destination,
                seq=seq, ack=ack, flags=[name for bit, name in
                    ((1, 'FIN'), (2, 'SYN'), (4, 'RST'), (16, 'ACK')) if flags & bit],
                ipId=struct.unpack_from('!H', frame, 18)[0],
                headerBytes=14 + ihl + tcp_length,
                payloadLength=total - ihl - tcp_length)


def network_counters():
    lines = Path('/proc/net/netstat').read_text().splitlines()
    wanted = {'ListenOverflows', 'ListenDrops', 'TCPReqQFullDrop', 'TCPReqQFullDoCookies',
              'TCPAbortOnData', 'TCPAbortOnClose', 'TCPAbortOnTimeout', 'TCPBacklogDrop'}
    result = {}
    for names, values in zip(lines[::2], lines[1::2]):
        if names.startswith('TcpExt:'):
            result.update((key, int(value)) for key, value in zip(names.split()[1:], values.split()[1:])
                          if key in wanted)
    return result


def emit(record):
    print(json.dumps(record, separators=(',', ':')), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--interface', default='eth0')
    parser.add_argument('--duration', type=float, default=40)
    parser.add_argument('--port', action='append', type=int, required=True)
    parser.add_argument('--max-events', type=int, default=10000)
    args = parser.parse_args()
    if args.duration <= 0 or args.max_events <= 0 or any(not 0 < port < 65536 for port in args.port):
        parser.error('positive duration/event limit and TCP ports 1..65535 are required')
    stop = False

    def stopping(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, stopping)
    signal.signal(signal.SIGINT, stopping)
    try:
        # Protocol zero receives nothing until bind, after the filter is attached.
        sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, 0)
        attach_filter(sock)
        # ETH_P_ALL also observes local outgoing frames; cBPF keeps only IPv4.
        sock.bind((args.interface, 0x0003))
    except OSError as error:
        emit(dict(event='capture_error', error=str(error), errno=error.errno,
                  note='Requires existing CAP_NET_RAW; no permissions were changed'))
        return 2
    before = network_counters()
    started = time.monotonic()
    count = 0
    emit(dict(event='capture_start', observedEpochNs=time.time_ns(), interface=args.interface,
              ports=args.port, duration=args.duration, counters=before,
              tcpAbortOnOverflow=int(Path('/proc/sys/net/ipv4/tcp_abort_on_overflow').read_text()),
              timestampKind='userspace observation', payloadCaptured=False))
    with sock:
        while not stop and count < args.max_events:
            remaining = args.duration - (time.monotonic() - started)
            if remaining <= 0:
                break
            sock.settimeout(min(.25, remaining))
            try:
                frame, address = sock.recvfrom(134)
            except socket.timeout:
                continue
            observed = time.time_ns()
            record = parse_frame(frame, set(args.port))
            if record is not None:
                emit(dict(event='tcp_control', observedEpochNs=observed,
                          interface=address[0], packetType=address[2],
                          direction='outgoing' if address[2] == 4 else 'incoming', **record))
                count += 1
        packets, drops = struct.unpack('II', sock.getsockopt(263, 6, 8))  # PACKET_STATISTICS
    after = network_counters()
    emit(dict(event='capture_end', observedEpochNs=time.time_ns(), events=count,
              durationSeconds=time.monotonic() - started, packetSocketPackets=packets,
              packetSocketDrops=drops, interrupted=stop, eventLimitReached=count >= args.max_events,
              counters=after, counterDelta={key: after[key] - value for key, value in before.items()}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

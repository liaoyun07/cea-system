"""Resident /process inputs: a small array directory followed by aligned raw bytes.

The directory is UTF-8 JSON prefixed by its uint32 little-endian byte length.
Each entry is [channel, dtype, shape]; each C-order array starts on an 8-byte
boundary. Only the existing float32 signals and int64 cycle ids are supported.
Feature/result responses continue to use NPZ, not this input-only format.
"""
import json
import math
import struct

import numpy as np

CONTENT_TYPE = 'application/vnd.cea.hydraulic-arrays'
_DTYPES = {'<f4': np.dtype('<f4'), '<i8': np.dtype('<i8')}
_MAX_HEADER_BYTES = 4096


def _description(name, dtype, shape):
    if not isinstance(name, str) or not name:
        raise ValueError('expected nonempty channel name')
    if not isinstance(dtype, str) or dtype not in _DTYPES:
        raise ValueError('expected little-endian float32 or int64')
    if (not isinstance(shape, (list, tuple)) or len(shape) not in (1, 2)
            or any(type(size) is not int or size <= 0 for size in shape)):
        raise ValueError('expected positive one- or two-dimensional shape')
    return _DTYPES[dtype], tuple(shape)


def encode_input(arrays):
    """Fixture preparation only; preserve each input array's C-order bytes."""
    directory, values = [], []
    for name, array in arrays.items():
        dtype, shape = _description(name, array.dtype.str, array.shape)
        directory.append([name, dtype.str, shape])
        values.append(array)
    if not directory:
        raise ValueError('expected input arrays')
    header = json.dumps(directory, separators=(',', ':')).encode('utf-8')
    if len(header) > _MAX_HEADER_BYTES:
        raise ValueError('array directory exceeds 4096 bytes')
    chunks = [struct.pack('<I', len(header)), header]
    offset = 4 + len(header)
    for array in values:
        padding = (-offset) % 8
        chunks.extend((b'\0' * padding, array.tobytes(order='C')))
        offset += padding + array.nbytes
    return b''.join(chunks)


def decode_input(body):
    """Return aligned, read-only views that keep the immutable body alive."""
    if not isinstance(body, bytes):
        raise ValueError('expected immutable input bytes')
    if len(body) < 4:
        raise ValueError('truncated array directory')
    header_size = struct.unpack_from('<I', body)[0]
    if header_size > _MAX_HEADER_BYTES:
        raise ValueError('array directory exceeds 4096 bytes')
    header_end = 4 + header_size
    if header_end > len(body):
        raise ValueError('truncated array directory')
    directory = json.loads(body[4:header_end])
    if not isinstance(directory, list) or not directory:
        raise ValueError('expected array directory')
    arrays, offset = {}, header_end
    for entry in directory:
        if not isinstance(entry, list) or len(entry) != 3:
            raise ValueError('expected channel, dtype and shape')
        name, dtype, shape = entry
        dtype, shape = _description(name, dtype, shape)
        if name in arrays:
            raise ValueError('duplicate channel')
        offset += (-offset) % 8
        count = math.prod(shape)
        end = offset + count * dtype.itemsize
        if end > len(body):
            raise ValueError('truncated array data')
        arrays[name] = np.frombuffer(body, dtype=dtype, count=count, offset=offset).reshape(shape)
        offset = end
    if offset != len(body):
        raise ValueError('unexpected trailing array data')
    return arrays

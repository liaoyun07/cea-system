"""Precompiled single-thread statistics kernel; no JIT inside or outside timing."""
import ctypes
from pathlib import Path
import numpy as np

_library = ctypes.CDLL(str(Path(__file__).with_name('libhydraulic_stats.so')))
_function = _library.hydraulic_stats
_function.argtypes = [ctypes.POINTER(ctypes.c_float), ctypes.c_size_t, ctypes.c_size_t,
                     ctypes.POINTER(ctypes.c_double)]
_function.restype = ctypes.c_int


def statistics(values, rate):
    # Any layout conversion and output allocation remain inside core timing.
    contiguous = np.ascontiguousarray(values)
    result = np.empty((len(values), 6, 5), dtype=np.float64)
    status = _function(contiguous.ctypes.data_as(ctypes.POINTER(ctypes.c_float)),
                       len(values) * 6, 10 * rate,
                       result.ctypes.data_as(ctypes.POINTER(ctypes.c_double)))
    if status:
        raise ValueError('non-finite source data')
    return result

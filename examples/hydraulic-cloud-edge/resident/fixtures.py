"""Prepare all original cycles once; verify live HTTP results against original full-array functions."""
import concurrent.futures
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from app import GROUPS, edge, fuse, load
from service import pack, unpack, summary


def prepare(source, output):
    output.mkdir(exist_ok=False)
    groups = {g: load(source / f'{g}.npz') for g in GROUPS}
    reference = load(source / 'reference.npz')
    parts = [edge(groups[g], g) for g in GROUPS]
    expected, _ = fuse(parts, reference, 3.)
    manifest = []
    for index, start in enumerate(range(0, len(reference['cycle_ids']), 64)):
        stop = min(start+64, len(reference['cycle_ids']))
        files, raw_bytes = [], 0
        for group in GROUPS:
            values = {name: array[start:stop] for name, array in groups[group].items()}
            payload = pack(values)
            filename = f'{index}-{group}.npz'
            (output / filename).write_bytes(payload)
            files.append(dict(name=filename, length=len(payload)))
            raw_bytes += sum(values[k].nbytes for k in GROUPS[group])
        result = {k: v[start:stop] for k, v in expected.items()}
        (output / f'{index}-expected.npz').write_bytes(pack(result))
        manifest.append(dict(files=files, expected=summary(result, raw_bytes)))
    (output / 'manifest.json').write_text(json.dumps(manifest))
    print(json.dumps(dict(batches=len(manifest), cycles=len(reference['cycle_ids']),
                         signalBytes=sum(m['expected']['inputBytes'] for m in manifest))))


def request(url, body=None):
    return urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=30).read()


def verify(folder, endpoints):
    manifest = json.loads((folder / 'manifest.json').read_text())
    for url in endpoints.values():
        request(url + '/reset', b'{"run":"correctness"}')
    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        for index, item in enumerate(manifest):
            calls = [pool.submit(request, endpoints[group] + f'/process/correctness/{index}',
                                 (folder / file['name']).read_bytes()) for group, file in zip(GROUPS, item['files'])]
            for call in calls:
                call.result()
            actual = unpack(request(endpoints['cloud'] + f'/binary/correctness/{index}'))
            expected = load(folder / f'{index}-expected.npz')
            assert actual.keys() == expected.keys()
            for key in expected:
                np.testing.assert_array_equal(actual[key], expected[key])
    print(json.dumps(dict(status='PASS', batches=len(manifest), cycles=sum(x['expected']['cycles'] for x in manifest),
                         arraysCompared=len(manifest)*len(expected),
                         stats={g: json.loads(request(u+'/stats')) for g, u in endpoints.items()})))


if __name__ == '__main__':
    if sys.argv[1] == 'prepare':
        prepare(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        verify(Path(sys.argv[2]), json.loads(sys.argv[3]))

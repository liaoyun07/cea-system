"""Read back published objects; verify against prepared data and prior equal experiment."""
import json
from pathlib import Path
import torch
from prepare import COUNTS

root=Path('/evidence')
for version,counts in COUNTS.items():
    seen=[]
    for c,count in zip('abc',counts):
        local=torch.load(root/'mnist-partitions'/version/f'edge-{c}.pt',weights_only=True)
        remote=torch.load(root/'mnist-partitions-readback'/version/f'edge-{c}.pt',weights_only=True)
        assert remote['dataset']=='mnist' and remote['split']=='train'
        assert len(remote['y'])==count
        assert all(torch.equal(remote[k],local[k]) for k in ('indices','x','y'))
        if version=='equal-noniid-v1':
            prior=torch.load(root/'conv04/run-1/mnist-equal'/f'edge-{c}.pt',weights_only=True)
            assert all(torch.equal(remote[k],prior[k]) for k in ('indices','x','y'))
        seen.append(remote['indices'])
    assert torch.equal(torch.cat(seen).sort().values,torch.arange(60000))
print(json.dumps({'passed':True,'versions':list(COUNTS),
    'verified':'6 published objects exactly match prepared values; each version contains all 60000 ids once; equal version matches prior experiment'}))

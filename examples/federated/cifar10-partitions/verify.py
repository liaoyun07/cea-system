import json
from pathlib import Path
import torch
from prepare import COUNTS
torch.set_num_threads(1)
root=Path('/evidence')
for version,counts in COUNTS.items():
    seen=[]
    for c,count in zip('abc',counts):
        local=torch.load(str(root/'cifar10-partitions'/version/f'edge-{c}.pt'),weights_only=True,mmap=True)
        remote=torch.load(str(root/'cifar10-partitions-readback'/version/f'edge-{c}.pt'),weights_only=True,mmap=True)
        assert remote['dataset']=='cifar10' and remote['split']=='train' and len(remote['y'])==count
        assert all(torch.equal(local[k],remote[k]) for k in ('indices','x','y'))
        seen.append(remote['indices'])
    assert torch.equal(torch.cat(seen).sort().values,torch.arange(50000))
print(json.dumps({'passed':True,'objects':6,'samplesPerVersion':50000,'readbackExact':True}))

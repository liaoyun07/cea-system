"""Full CIFAR-10 label-skew partitions, preserving every original sample."""
import argparse
import json
from pathlib import Path
import torch

COUNTS={'equal-noniid-v1':(16667,16667,16666),'strong-noniid-v1':(2500,10000,37500)}

def partition(indices,x,y,counts):
    assert sum(counts)==len(indices) and len(torch.unique(indices))==len(indices)
    order=torch.argsort(y,stable=True)
    rows=[]
    offset=0
    for count in counts:
        selected=order[offset:offset+count]
        rows.append({'dataset':'cifar10','split':'train','indices':indices[selected],
                     'x':x[selected],'y':y[selected]})
        offset+=count
    return rows

def prepare(source,output):
    torch.set_num_threads(1)
    raw=[torch.load(str(source/f'edge-{c}.pt'),weights_only=True,mmap=True) for c in 'abc']
    indices,x,y=(torch.cat([d[k] for d in raw]) for k in ('indices','x','y'))
    assert x.shape==(50000,3,32,32) and y.shape==(50000,)
    assert torch.equal(indices.sort().values,torch.arange(50000))
    output.mkdir(parents=True,exist_ok=False)
    manifests=[]
    for version,counts in COUNTS.items():
        folder=output/version
        folder.mkdir()
        shards=partition(indices,x,y,counts)
        rows=[]
        for c,payload,count in zip('abc',shards,counts):
            torch.save(payload,folder/f'edge-{c}.pt')
            actual=torch.load(str(folder/f'edge-{c}.pt'),weights_only=True,mmap=True)
            assert all(torch.equal(actual[k],payload[k]) for k in ('indices','x','y'))
            # Check against originals by original index; do not just trust serialization.
            lookup=torch.argsort(indices)[actual['indices']]
            assert torch.equal(actual['x'],x[lookup]) and torch.equal(actual['y'],y[lookup])
            rows.append({'cluster':f'edge-{c}','samples':count,
                         'labels':torch.bincount(payload['y'],minlength=10).tolist()})
        assert torch.equal(torch.cat([s['indices'] for s in shards]).sort().values,torch.arange(50000))
        manifest={'datasetId':'cifar10-train','version':version,'trainSamples':50000,
                  'clients':rows,'testDataset':'cifar10-test/v1',
                  'partition':'label-sorted non-IID, full original ids exactly once, unchanged pixels and labels'}
        (folder/'manifest.json').write_text(json.dumps(manifest,indent=2))
        manifests.append(manifest)
    (output/'manifest.json').write_text(json.dumps(manifests,indent=2))
    print(json.dumps(manifests),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    prepare(args.source,args.output)

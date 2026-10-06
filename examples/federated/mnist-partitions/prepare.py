"""Two disjoint full MNIST train partitions; same normalized samples, no training."""
import argparse
import json
from pathlib import Path
import torch

COUNTS={'equal-noniid-v1':(20000,20000,20000), 'strong-noniid-v1':(3000,12000,45000)}


def partition(indices,x,y,counts):
    assert sum(counts)==len(indices) and len(torch.unique(indices))==len(indices)
    order=torch.argsort(y,stable=True)
    shards=[]
    offset=0
    for count in counts:
        selected=order[offset:offset+count]
        shards.append({'dataset':'mnist','split':'train','indices':indices[selected],
                       'x':x[selected],'y':y[selected]})
        offset+=count
    assert torch.equal(torch.cat([d['indices'] for d in shards]),indices[order])
    assert torch.equal(torch.cat([d['x'] for d in shards]),x[order])
    assert torch.equal(torch.cat([d['y'] for d in shards]),y[order])
    return shards


def prepare(source,output):
    torch.set_num_threads(1)
    raw=[torch.load(source/f'edge-{c}.pt',map_location='cpu',weights_only=True) for c in 'abc']
    indices=torch.cat([d['indices'] for d in raw])
    x=torch.cat([d['x'] for d in raw])
    y=torch.cat([d['y'] for d in raw])
    assert x.shape==(60000,1,28,28) and y.shape==(60000,)
    assert torch.equal(indices.sort().values,torch.arange(60000))
    output.mkdir(parents=True,exist_ok=False)
    manifests=[]
    for version,counts in COUNTS.items():
        folder=output/version
        folder.mkdir()
        shards=partition(indices,x,y,counts)
        rows=[]
        for c,payload,count in zip('abc',shards,counts):
            torch.save(payload,folder/f'edge-{c}.pt')
            actual=torch.load(folder/f'edge-{c}.pt',map_location='cpu',weights_only=True)
            assert all(torch.equal(actual[k],payload[k]) for k in ('indices','x','y'))
            rows.append({'cluster':f'edge-{c}','samples':count,
                         'labels':torch.bincount(payload['y'],minlength=10).tolist()})
        manifest={'datasetId':'mnist-train','version':version,'trainSamples':60000,
            'partition':'label-sorted disjoint shards; non-IID','clients':rows,
            'testDataset':'mnist-test/v1','integrity':'60000 original ids exactly once; pixels/labels unchanged'}
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

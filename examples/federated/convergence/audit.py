"""Read actual initial models and independently recompute time-to-target."""
import argparse
import json
from pathlib import Path
from datetime import datetime

import torch


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def seconds(start,end):
    return (datetime.fromisoformat(end.replace('Z','+00:00'))-datetime.fromisoformat(start.replace('Z','+00:00'))).total_seconds()


def audit(root):
    config=read(root/'config.json')
    indexed=[(i,read(root/f'trial-{i}.json')) for i in range(12) if (root/f'trial-{i}.json').exists()]
    trials=[t for i,t in indexed]
    summary=read(root/('summary.json' if (root/'summary.json').exists() else 'partial-summary.json'))
    rows=[]
    for i,t in indexed:
        if t['warmup']:
            continue
        model=torch.load(root/f'init-{i}.pt',weights_only=True,map_location='cpu')
        assert model['round']==0 and model['algorithm']==t['algorithm']
        if t['algorithm']=='fedcads':
            peer_index=next(j for j,p in indexed if not p['warmup'] and p['seed']==t['seed'] and p['algorithm']=='fedavg')
            avg=torch.load(root/f'init-{peer_index}.pt',weights_only=True,map_location='cpu')
            assert all(torch.equal(model['state']['base.'+k],v) for k,v in avg['state'].items())
            assert model['clientWeights']=={'edge-a':0.5,'edge-b':1.0,'edge-c':1.5}
        target=None
        for evaluation in t['evaluations']:
            assert evaluation['samples']==10000 and evaluation['algorithm']==t['algorithm']
            exact=seconds(t['execution']['createdAt'],evaluation['endedAt'])
            # JS Date uses milliseconds; independently parsed timestamps retain microseconds.
            assert abs(exact-evaluation['seconds'])<0.002
            if target is None and evaluation['accuracy']>=config['targetAccuracy']:
                target=evaluation
        assert target==t['firstHit']
        if t['execution']['state']=='SUCCESS':
            assert [r['round'] for r in t['evaluations']]==list(range(1,13))
        rows.append({'seed':t['seed'],'algorithm':t['algorithm'],'state':t['execution']['state'],'hit':target})
    paired=[]
    for seed in config['seeds']:
        a=next((r for r in rows if r['seed']==seed and r['algorithm']=='fedavg'),None)
        c=next((r for r in rows if r['seed']==seed and r['algorithm']=='fedcads'),None)
        valid=a is not None and c is not None and a['state']==c['state']=='SUCCESS' and a['hit'] is not None and c['hit'] is not None
        ratio=a['hit']['seconds']/c['hit']['seconds']-1 if valid else None
        recorded=next(p for p in summary['pairs'] if p['seed']==seed)
        assert ratio==recorded['improvement']
        paired.append({'seed':seed,'valid':valid,'improvement':ratio})
    jobs=[item for cluster in ('cloud','edge-a','edge-b','edge-c') for item in read(root/f'jobs-{cluster}.json')]
    assert len(jobs)==sum(len([t for t in trial['tasks'] if t['taskId'] in ('init','train','aggregate','evaluate') and t['startedAt'] is not None]) for trial in trials)
    images={c['image'] for job in jobs for c in job['containers'] if c['name']=='task'}
    digests={image.split('@')[1] for image in images}
    assert len(digests)==1
    assert all(c['resources']=={} for job in jobs for c in job['containers'])
    assert read(root/'before.json')['services']==summary['servicesAfter']
    (root/'audit.json').write_text(json.dumps({'initialPrimaryWeightsIdentical':True,'independentTiming':True,
        'sameJobDigest':next(iter(digests)),'jobCount':len(jobs),'pairs':paired},indent=2))
    print(json.dumps({'checks':'PASS','pairs':paired,'jobCount':len(jobs)},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args()
    audit(args.root)

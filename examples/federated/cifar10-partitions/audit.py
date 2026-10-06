"""Independent completed-run verification, not a training observer."""
import json
from datetime import datetime
from pathlib import Path
import torch
import model
import fedcads
torch.set_num_threads(1)
root=Path('/audit')
manifest=json.loads((root/'audit-input.json').read_text())
image=manifest['image']
initial={a:torch.load(root/f'{a}-init.pt',weights_only=True) for a in ('fedavg','fedcads')}
assert all(torch.equal(initial['fedavg']['state'][k],initial['fedcads']['state']['base.'+k]) for k in initial['fedavg']['state'])
assert initial['fedcads']['totalRounds']==40
counts=manifest['counts']
expected={f'edge-{c}':n*3/50000 for c,n in zip('abc',counts)}
assert initial['fedcads']['clientWeights']==expected
test=torch.load('/test.pt',weights_only=True)
assert test['dataset']=='cifar10' and len(test['y'])==10000
results=[]
for algorithm in ('fedavg','fedcads'):
    trial=json.loads((root/f'{algorithm}.json').read_text())
    assert trial['execution']['state']=='SUCCESS'
    assert [r['round'] for r in trial['evaluations']]==list(range(1,41))
    assert all(r['samples']==10000 for r in trial['evaluations'])
    for c,count in zip('abc',counts):
        client=torch.load(root/f'{algorithm}-edge-{c}.pt',weights_only=True)
        assert client['samples']==count and client['clientId']==f'edge-{c}'
        assert client['dataset']=='cifar10' and client['model']=='cnn'
        assert client['round']==1 and client['baseRound']==0
    final=torch.load(root/f'{algorithm}-final.pt',weights_only=True)
    assert final['round']==40
    network=fedcads.checked_model(final) if algorithm=='fedcads' else model.checked_model(final)
    score=model.evaluate(network,test,128)
    assert score['accuracy']==trial['evaluations'][-1]['accuracy']
    assert abs(score['loss']-trial['evaluations'][-1]['loss'])<1e-10
    start=datetime.fromisoformat(trial['execution']['startedAt'].replace('Z','+00:00'))
    end=datetime.fromisoformat(trial['execution']['endedAt'].replace('Z','+00:00'))
    assert abs((end-start).total_seconds()-trial['seconds'])<.002
    first=next((r for r in trial['evaluations'] if r['accuracy']>=.90),None)
    first_time=(datetime.fromisoformat(first['endedAt'].replace('Z','+00:00'))-start).total_seconds() if first else None
    results.append({'algorithm':algorithm,'finalAccuracy':score['accuracy'],
        'bestAccuracy':max(r['accuracy'] for r in trial['evaluations']),
        'wholeFlowSeconds':(end-start).total_seconds(),'first90Round':first['round'] if first else None,
        'first90Seconds':first_time,'allSubsequentAbove90':bool(first) and all(r['accuracy']>=.90 for r in trial['evaluations'][first['round']-1:])})
jobs=[]
for cluster in ('cloud','edge-a','edge-b','edge-c'):
    rows=json.loads((root/f'jobs-{cluster}.json').read_text())
    for job in rows:
        assert job['status'].get('succeeded')==1
        registry='registry-center' if cluster=='cloud' else f'registry-{cluster}'
        assert any(c['image'].startswith(f'{registry}:5000/lab/') and c['image'].split('@')[-1]==image.split('@')[-1] for c in job['containers'])
        assert all(c['resources']=={} for c in job['containers'])
    jobs.extend(rows)
assert len(jobs)==402 and len({(j['cluster'],j['name']) for j in jobs})==402
times=[r['first90Seconds'] for r in results]
report={'passed':True,'jobs':402,'clientSamples':counts,'sameMainInitialWeights':True,
        'results':results,'speedGainPercent':(times[0]/times[1]-1)*100 if all(times) else None}
(root/'audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

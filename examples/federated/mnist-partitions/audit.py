import json
from pathlib import Path
from datetime import datetime
import torch
import model
import fedcads

torch.set_num_threads(1)
root=Path('/audit')
image='registry-center:5000/lab/cea-federated@sha256:71768d8fc05aaa34c2b97f657f08d2d31b5a1384bfa3e614b3fa5bdbe01df47b'
initial={a:torch.load(root/f'{a}-init.pt',weights_only=True) for a in ('fedavg','fedcads')}
assert all(torch.equal(initial['fedavg']['state'][k],initial['fedcads']['state']['base.'+k]) for k in initial['fedavg']['state'])
assert initial['fedcads']['totalRounds']==40
assert initial['fedcads']['clientWeights']=={'edge-a':.15,'edge-b':.6,'edge-c':2.25}
test=torch.load('/test.pt',weights_only=True)
results=[]
for algorithm in ('fedavg','fedcads'):
    trial=json.loads((root/f'{algorithm}.json').read_text())
    assert trial['execution']['state']=='SUCCESS'
    assert len(trial['evaluations'])==40
    for c,count in zip('abc',(3000,12000,45000)):
        client=torch.load(root/f'{algorithm}-edge-{c}.pt',weights_only=True)
        assert client['samples']==count and client['clientId']==f'edge-{c}'
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
    first=next((r for r in trial['evaluations'] if r['accuracy']>=.95),None)
    first_time=(datetime.fromisoformat(first['endedAt'].replace('Z','+00:00'))-start).total_seconds() if first else None
    results.append({'algorithm':algorithm,'finalAccuracy':score['accuracy'],'finalLoss':score['loss'],
        'wholeFlowSeconds':(end-start).total_seconds(),
        'first95Round':first['round'] if first else None,'first95Seconds':first_time,
        'allSubsequentAbove95':bool(first) and all(r['accuracy']>=.95 for r in trial['evaluations'][first['round']-1:])})
jobs=[]
for cluster in ('cloud','edge-a','edge-b','edge-c'):
    rows=json.loads((root/f'jobs-{cluster}.json').read_text())
    for job in rows:
        assert job['status'].get('succeeded')==1
        registry='registry-center' if cluster=='cloud' else f'registry-{cluster}'
        assert any(c['image'].startswith(f'{registry}:5000/lab/') and c['image'].split('@')[-1]==image.split('@')[-1] for c in job['containers'])
        assert all(c['resources']=={} for c in job['containers'])
    jobs.extend(rows)
assert len(jobs)==402
assert len({(j['cluster'],j['name']) for j in jobs})==402
report={'passed':True,'jobs':len(jobs),'sameMainInitialWeights':True,
    'clientSamples':[3000,12000,45000],'cadsSchedule':40,'finalReevaluation':results,
    'image':image,'durationRecomputed':True}
(root/'audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

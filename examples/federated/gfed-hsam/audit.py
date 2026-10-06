"""Recheck deployed artifacts, all server state equations, and global evaluations.

Replays the first client's two actual local trainings using an independent
four-gradient implementation, not gfed_hsam.train/aggregate.
"""
import json
from pathlib import Path

import torch
from torch.nn import functional as F
from torch.utils.data import DataLoader, TensorDataset
from model import build_model, checked_model, evaluate

torch.set_num_threads(1)
root = Path('/audit')
trial = json.loads((root / 'result.json').read_text())
artifacts = json.loads((root / 'artifacts.json').read_text())
payloads = [(a, torch.load(root / a['name'], weights_only=True)) for a in artifacts]
initial = next(p for a,p in payloads if a['stage']=='init')
assert initial['round']==0 and initial['algorithm']=='gfed-hsam'
torch.manual_seed(31)
for key,value in build_model('mnist','mlp').state_dict().items():
    torch.testing.assert_close(initial['state'][key],value,rtol=0,atol=0)
assert initial['clients']==['edge-a','edge-b','edge-c']
for key in ('clientDrift','perturbationDual'):
    assert all(float(v.norm())==0 for v in initial[key].values())
assert float(initial['globalDrift'].norm())==float(initial['globalPerturbation'].norm())==0

def flat(model):
    return torch.cat([p.detach().reshape(-1) for p in model.parameters()]).clone()

def normalized(v):
    return v / v.norm().clamp_min(1e-12)

def replay(previous, shard):
    model = checked_model(previous).train()
    anchor = flat(model)
    dual = previous['perturbationDual']['edge-a'].clone()
    drift = previous['clientDrift']['edge-a']
    shared = previous['globalPerturbation']
    loader = DataLoader(TensorDataset(shard['x'],shard['y']),batch_size=128,shuffle=True,
                        generator=torch.Generator().manual_seed(31+previous['round']))
    def gradient(vector,x,y):
        # Explicit copying to parameter blocks differs from production assignment.
        pos=0
        with torch.no_grad():
            for parameter in model.parameters():
                count=parameter.numel()
                parameter.copy_(vector[pos:pos+count].view_as(parameter));pos+=count
        model.zero_grad(set_to_none=True)
        F.cross_entropy(model(x),y).backward()
        return torch.cat([p.grad.reshape(-1) for p in model.parameters()]).clone()
    for x,y in loader:
        base=flat(model)
        g0=gradient(base,x,y)
        s0=.05*normalized(g0-dual-shared)
        g1=gradient(base+s0,x,y)
        s1=.05*normalized(g1-g0-dual-shared)
        g2=gradient(base+s1,x,y)
        g3=gradient(base+s1+.05*normalized(g2),x,y)
        corrected=g3+.5*(.5*g1+.5*g3-(.5*g0+.5*g2))
        disturbance=s0+s1
        dual=dual+disturbance-shared
        direction=corrected+.001*(base-anchor+drift)
        next_params=base-.1*direction
        pos=0
        with torch.no_grad():
            for p in model.parameters():
                count=p.numel();p.copy_(next_params[pos:pos+count].view_as(p));pos+=count
    return flat(model),dual,dual-disturbance

previous=initial
scores=[]
for round_number in (1,2):
    updates=[p for a,p in payloads if a['stage']=='train' and p['round']==round_number]
    assert len(updates)==3
    by_client={p['clientId']:p for p in updates}
    assert set(by_client)==set(initial['clients'])
    anchor=flat(checked_model(previous))
    for client,count in zip(initial['clients'],(3000,12000,45000)):
        local=by_client[client]
        assert local['samples']==count and local['baseRound']==round_number-1
        torch.testing.assert_close(local['clientDrift'],previous['clientDrift'][client]+anchor-flat(checked_model(local)))
    current=next(p for a,p in payloads if a['stage']=='aggregate' and p['round']==round_number)
    vectors=[flat(checked_model(by_client[client])) for client in initial['clients']]
    mean=torch.stack(vectors).mean(0)
    expected_drift=previous['globalDrift']+anchor-mean
    expected_shared=.05*normalized(torch.stack([by_client[c]['perturbationResidual'] for c in initial['clients']]).mean(0))
    torch.testing.assert_close(flat(checked_model(current)),mean-expected_drift)
    torch.testing.assert_close(current['globalDrift'],expected_drift)
    torch.testing.assert_close(current['globalPerturbation'],expected_shared)
    for client in initial['clients']:
        for key in ('clientDrift','perturbationDual'):
            torch.testing.assert_close(current[key][client],by_client[client][key])
    expected_local,expected_dual,expected_residual=replay(previous,torch.load('/train/edge-a.pt',weights_only=True))
    torch.testing.assert_close(flat(checked_model(by_client['edge-a'])),expected_local,rtol=1e-5,atol=1e-6)
    torch.testing.assert_close(by_client['edge-a']['perturbationDual'],expected_dual,rtol=1e-5,atol=1e-6)
    torch.testing.assert_close(by_client['edge-a']['perturbationResidual'],expected_residual,rtol=1e-5,atol=1e-6)
    score=evaluate(checked_model(current),torch.load('/test.pt',weights_only=True),128)
    remote=next(e for e in trial['evaluations'] if e['round']==round_number)
    assert score['accuracy']==remote['accuracy'] and score['samples']==10000
    assert abs(score['loss']-remote['loss'])<1e-10
    assert torch.isfinite(flat(checked_model(current))).all()
    scores.append({'round':round_number,**score})
    previous=current
jobs=[]
digest='sha256:af333cdd63056cf08531fd74519e95be2633b2e23458e642e07247778ace0fd8'
for cluster in ('cloud','edge-a','edge-b','edge-c'):
    rows=json.loads((root/f'jobs-{cluster}.json').read_text())
    for job in rows:
        assert job['status'].get('succeeded')==1
        assert any(c['image'].endswith('@'+digest) and '/app/gfed_hsam_app.py' in
                   ' '.join(c['command']+(c.get('args') or [])) for c in job['containers'])
    jobs.extend(rows)
assert len(jobs)==11
report={'passed':True,'executionId':trial['execution']['id'],'jobs':len(jobs),'modelArtifacts':len(payloads),
        'clientSamples':[3000,12000,45000],'independentClientReplayRounds':2,
        'serverStateEquationsVerified':True,'evaluations':scores,'imageDigest':digest}
(root/'audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

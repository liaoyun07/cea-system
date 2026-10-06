"""Independently audit actual initial models, flow timing and exact deployed Jobs."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import torch

def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def instant(s):return datetime.fromisoformat(s.replace('Z','+00:00'))

def audit(root):
    trials=[read(root/f'trial-{i}.json') for i in range(12)]
    summary=read(root/'summary.json')
    baseline=read(root/'baseline-curves.json')
    matched=0
    crossing=[]
    for i,t in enumerate(trials):
        assert t['execution']['state']=='SUCCESS'
        assert [e['round'] for e in t['evaluations']]==list(range(1,t['rounds']+1))
        assert all(e['samples']==10000 and e['algorithm']==t['algorithm'] for e in t['evaluations'])
        exact=(instant(t['execution']['endedAt'])-instant(t['execution']['startedAt'])).total_seconds()
        assert abs(t['seconds']-exact)<.002
        assert all('cea-measurement.json' not in task['outputs'] for task in t['tasks'])
        if not t['warmup']:
            hit=next((e for e in t['evaluations'] if e['accuracy']>=summary['config']['target']),None)
            leaf=next((task for task in t['tasks'] if hit and task['id']==hit['taskRunId']),None)
            crossing.append({'seed':t['seed'],'algorithm':t['algorithm'],'round':hit['round'] if hit else None,
                'accuracy':hit['accuracy'] if hit else None,
                'seconds':(instant(leaf['endedAt'])-instant(t['execution']['startedAt'])).total_seconds() if leaf else None})
            prior=next((p for p in baseline if p['seed']==t['seed'] and p['algorithm']==t['algorithm']),None)
            if prior:
                for evaluation in t['evaluations']:
                    old=next((e for e in prior['evaluations'] if e['round']==evaluation['round']),None)
                    if old:
                        assert evaluation['accuracy']==old['accuracy'] and abs(evaluation['loss']-old['loss'])<1e-10
                        matched+=1
        if not t['warmup'] and t['algorithm']=='fedcads':
            model=torch.load(root/f'init-{i}.pt',map_location='cpu',weights_only=True)
            peer=next(j for j,p in enumerate(trials) if not p['warmup'] and p['seed']==t['seed'] and p['algorithm']=='fedavg')
            avg=torch.load(root/f'init-{peer}.pt',map_location='cpu',weights_only=True)
            assert all(torch.equal(model['state']['base.'+k],v) for k,v in avg['state'].items())
            assert model['totalRounds']==12 and model['clientWeights']=={'edge-a':.5,'edge-b':1.,'edge-c':1.5}
    valid=[]
    for p in summary['pairs']:
        a=next(t for t in trials if not t['warmup'] and t['seed']==p['seed'] and t['algorithm']=='fedavg')
        c=next(t for t in trials if not t['warmup'] and t['seed']==p['seed'] and t['algorithm']=='fedcads')
        qualifies=a['final']['accuracy']>=.9 and c['final']['accuracy']>=.9
        assert p['valid']==qualifies
        if qualifies:
            assert p['efficiency']==a['seconds']/c['seconds']-1
            valid.append((a['seconds'],c['seconds']))
        else:assert p['efficiency'] is None
    assert summary['validPairs']==len(valid)
    if valid:assert summary['meanEfficiency']==sum(a for a,c in valid)/sum(c for a,c in valid)-1
    jobs=[j for cluster in ('cloud','edge-a','edge-b','edge-c') for j in read(root/f'jobs-{cluster}.json')]
    leaves=[task for t in trials for task in t['tasks'] if task['taskId'] in ('init','train','aggregate','evaluate')]
    expected=22+sum(1+5*t['rounds'] for t in trials if not t['warmup'])
    assert len(jobs)==len(leaves)==expected
    digest={c['image'].split('@')[1] for j in jobs for c in j['containers'] if c['name']=='task'}
    assert len(digest)==1 and next(iter(digest))=='sha256:15554d3f13ab13aa5393756b36ce6bee48639f4e8e4dbb00f8319ba4c1441b9b'
    assert all(c['resources']=={} for j in jobs for c in j['containers'])
    assert all(j['status'].get('succeeded')==1 for j in jobs)
    assert read(root/'before.json')['services']==summary['servicesAfter']
    crossing_pairs=[]
    for seed in summary['config']['seeds']:
        a=next(r for r in crossing if r['seed']==seed and r['algorithm']=='fedavg')
        c=next(r for r in crossing if r['seed']==seed and r['algorithm']=='fedcads')
        crossing_pairs.append({'seed':seed,'avg':a,'cads':c,
            'efficiency':a['seconds']/c['seconds']-1 if a['seconds'] is not None and c['seconds'] is not None else None})
    complete_crossing=[p for p in crossing_pairs if p['efficiency'] is not None]
    crossing_efficiency=sum(p['avg']['seconds'] for p in complete_crossing)/sum(p['cads']['seconds'] for p in complete_crossing)-1 if complete_crossing else None
    (root/'first-crossing-audit.json').write_text(json.dumps({'metric':'Retrospective first successful evaluation, not actual flow termination',
        'pairs':crossing_pairs,'meanEfficiency':crossing_efficiency,
        'allFiveAtLeast25':len(complete_crossing)==5 and all(p['efficiency']>=.25 for p in complete_crossing)},indent=2))
    result={'checks':'PASS','primaryInitialWeightsIdentical':True,'cadsSchedule12':True,'noSdkReports':True,
        'independentStartEndDuration':True,'priorMatchingEvaluations':matched,'jobCount':len(jobs),'validPairs':len(valid),'allFiveAtLeast25':summary['allFiveAtLeast25'],
        'firstCrossingMeanEfficiency':crossing_efficiency}
    (root/'audit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);args=parser.parse_args();audit(args.root)

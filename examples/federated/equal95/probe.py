"""Equal-size MNIST partition and bounded numerical accuracy experiment, not CEA timing."""
import argparse
import json
from pathlib import Path

import torch
import model as avg
import fedcads


def repartition(source, output):
    shards = [avg.load(source / f'edge-{c}.pt') for c in 'abc']
    indices = torch.cat([d['indices'] for d in shards])
    x = torch.cat([d['x'] for d in shards])
    y = torch.cat([d['y'] for d in shards])
    assert len(indices) == 60000 and len(torch.unique(indices)) == 60000
    assert torch.equal(indices.sort().values, torch.arange(60000))
    order = torch.argsort(y, stable=True)
    output.mkdir(parents=True, exist_ok=False)
    rows = []
    for i, c in enumerate('abc'):
        selected = order[i*20000:(i+1)*20000]
        payload = {'dataset':'mnist','split':'train','indices':indices[selected],
                   'x':x[selected], 'y':y[selected]}
        torch.save(payload, output / f'edge-{c}.pt')
        restored = avg.load(output / f'edge-{c}.pt')
        assert all(torch.equal(restored[k], payload[k]) for k in ('indices','x','y'))
        rows.append({'client':f'edge-{c}','samples':20000,
                     'labels':torch.bincount(payload['y'],minlength=10).tolist()})
    # Repartitioning never changes pixels, labels, normalization or official test.
    test = avg.load(source / 'test.pt')
    assert len(test['y']) == 10000
    torch.save(test, output / 'test.pt')
    joined = [avg.load(output / f'edge-{c}.pt') for c in 'abc']
    assert torch.equal(torch.cat([d['indices'] for d in joined]), indices[order])
    assert torch.equal(torch.cat([d['x'] for d in joined]), x[order])
    assert torch.equal(torch.cat([d['y'] for d in joined]), y[order])
    manifest = {'partition':'label-sorted disjoint equal shards; NOT IID',
                'trainSamples':60000,'testSamples':10000,'clients':rows,
                'integrity':'all 60000 original sample ids exactly once; pixels and labels unchanged'}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    return joined, test, manifest


def run(source, output):
    torch.set_num_threads(1)
    output.mkdir(parents=True, exist_ok=False)
    train, test, partition = repartition(source, output / 'mnist-equal')
    clients = [{'id':f'edge-{c}','weight':20000} for c in 'abc']
    protocol = {'target':.95,'maxRounds':40,'seeds':[31,41,51],'model':'mlp',
        'learningRate':.1,'batchSize':128,'localEpochs':1,'alpha':.001,'rho':.1,
        'cadsScheduleRounds':12,'partition':partition,
        'scope':'full 60000 training / official 10000 test, cached sequential Docker computation; NOT CEA flow timing',
        'comparison':'only equalizes sample counts; preserves non-IID label-sort, network, optimizer and CADS schedule'}
    (output / 'protocol.json').write_text(json.dumps(protocol, indent=2))
    records = []
    for seed in protocol['seeds']:
        for algorithm in ('fedavg','fedcads'):
            torch.manual_seed(seed)
            original = avg.build_model('mnist','mlp').state_dict()
            state = ({'algorithm':algorithm,'dataset':'mnist','model':'mlp','round':0,'state':original}
                if algorithm=='fedavg' else fedcads.initialize('mnist','mlp',clients,seed,12))
            if algorithm=='fedcads':
                assert all(torch.equal(state['state']['base.'+k],v) for k,v in original.items())
                assert state['clientWeights']=={c['id']:1.0 for c in clients}
            record = {'algorithm':algorithm,'seed':seed,'rows':[]}
            records.append(record)
            for r in range(40):
                updates=[]
                for client,data in zip(clients,train):
                    if algorithm=='fedcads':
                        update=fedcads.train(state,data,client['id'],1,128,.1,.001,seed)
                    else:
                        network=avg.checked_model(state)
                        avg.train(network,data,1,128,.1,0,seed+r)
                        update={'algorithm':algorithm,'dataset':'mnist','model':'mlp','round':r+1,
                            'baseRound':r,'clientId':client['id'],'samples':len(data['y']),
                            'state':network.state_dict()}
                    updates.append(update)
                state = fedcads.aggregate(state,updates,.1) if algorithm=='fedcads' else avg.aggregate(updates)
                network = fedcads.checked_model(state) if algorithm=='fedcads' else avg.checked_model(state)
                score = avg.evaluate(network,test,128)
                row={'round':r+1,'accuracy':score['accuracy'],'loss':score['loss'],'samples':score['samples']}
                record['rows'].append(row)
                (output / 'curves.json').write_text(json.dumps(records, indent=2))
                print(json.dumps({'algorithm':algorithm,'seed':seed,**row}),flush=True)
    summary=[]
    for record in records:
        crossed=[r['round'] for r in record['rows'] if r['accuracy']>=.95]
        best=max(record['rows'],key=lambda r:r['accuracy'])
        summary.append({'algorithm':record['algorithm'],'seed':record['seed'],
            'first95Round':crossed[0] if crossed else None,'best':best,
            'final':record['rows'][-1],
            'stayedAbove95':bool(crossed) and all(r['accuracy']>=.95 for r in record['rows'][crossed[0]-1:])})
    (output / 'summary.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps({'summary':summary}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args()
    run(args.source,args.output)

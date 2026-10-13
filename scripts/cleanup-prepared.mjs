// One-off, explicitly authorized cleanup of completed CEA preprocessing artifacts.
// Credentials stay in stdin; evidence contains only object keys/sizes and execution IDs.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2];assert(['plan','delete'].includes(mode));
const folder=`${root}/.local/cea/prepared-cleanup`;mkdirSync(folder,{recursive:true});
const settings=Object.fromEntries(readFileSync(`${root}/deploy/cea/.env`,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const docker=(args,options={})=>execFileSync('docker',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true,...options});
function sql(query){return docker(['exec','cea-mysql-1','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -D cea -B -N -e "$1"','prepared-cleanup',query]).trim();}
assert.equal(sql("SELECT COUNT(*) FROM wf_execution WHERE state NOT IN ('SUCCESS','FAILED','KILLED','SKIPPED')"),'0','Active executions');
assert.equal(sql("SELECT COUNT(*) FROM wf_task_run WHERE state NOT IN ('SUCCESS','FAILED','KILLED','SKIPPED')"),'0','Unfinished task runs');
assert.equal(sql("SELECT COUNT(*) FROM wf_flow_revision WHERE definition_json LIKE '%s3://cea-artifacts%prepared.pt%'"),'0','Stored flow references');
assert.equal(sql("SELECT COUNT(*) FROM res_dataset_location WHERE uri LIKE '%prepared.pt%'"),'0','Dataset references');
const executions=sql("SELECT id FROM wf_execution WHERE namespace='lab'").split('\n');
const code=String.raw`
import sys,json,re,boto3
config=json.load(sys.stdin)
executions=set(config['executions'])
pattern=re.compile(r'^lab/([0-9a-f-]{36})/[0-9a-f-]{36}/[1-9][0-9]*/prepared\.pt$')
results=[]
for name in ['center','edge-a','edge-b','edge-c']:
    service='minio' if name=='center' else 'minio-'+name
    bucket='cea-artifacts' if name=='center' else 'cea-artifacts-'+name
    s3=boto3.client('s3',endpoint_url='http://'+service+':9000',aws_access_key_id=config['access'],aws_secret_access_key=config['secret'])
    def objects():
        return {o['Key']:o['Size'] for p in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix='lab/') for o in p.get('Contents',[])}
    before=objects()
    selected={k:v for k,v in before.items() if pattern.fullmatch(k)}
    assert all(pattern.fullmatch(k)[1] in executions for k in selected), 'Unknown execution'
    result={'store':name,'bucket':bucket,'objects':selected,'count':len(selected),'bytes':sum(selected.values()),'otherCount':len(before)-len(selected)}
    if config['mode']=='delete':
        expected=next(p for p in config['plan']['stores'] if p['store']==name)
        assert selected==expected['objects'], 'Inventory changed since plan'
        keys=list(selected)
        for i in range(0,len(keys),500):
            response=s3.delete_objects(Bucket=bucket,Delete={'Objects':[{'Key':k} for k in keys[i:i+500]],'Quiet':True})
            assert not response.get('Errors'), response.get('Errors')
        after=objects()
        assert after=={k:v for k,v in before.items() if k not in selected}, 'Other objects changed or deletion incomplete'
        result['verified']=True
    results.append(result)
print(json.dumps({'stores':results,'count':sum(r['count'] for r in results),'bytes':sum(r['bytes'] for r in results)}))
`;
const plan=mode==='delete'?JSON.parse(readFileSync(`${folder}/plan.json`,'utf8')):undefined;
const result=JSON.parse(docker(['exec','-i','cea-edge-gateway-1','python','-c',code],{input:JSON.stringify({mode,plan,executions,access:settings.MINIO_ROOT_USER,secret:settings.MINIO_ROOT_PASSWORD})}));
result.at=new Date().toISOString();
writeFileSync(`${folder}/${mode==='plan'?'plan':'deleted'}.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({mode,count:result.count,GiB:result.bytes/1024**3,stores:result.stores.map(({store,count,bytes,verified})=>({store,count,GiB:bytes/1024**3,verified}))}));

"""Active CEA pilot: creates real requests and six dedicated policies. Not a read-only check."""
import argparse
import base64
import concurrent.futures
import json
import math
import random
import sys
import time
import urllib.request
import uuid
from pathlib import Path
from train import export, network, fit

def summary(rows):
    success = [r for r in rows if r["success"]]
    values = sorted(r["elapsedSeconds"] for r in success if r["elapsedSeconds"] is not None)
    return {"submitted": len(rows), "success": len(success), "successRate": len(success)/len(rows) if rows else None,
            "measuredSuccess": len(values), "meanSeconds": sum(values)/len(values) if values else None,
            "p95Seconds": values[math.ceil(.95*len(values))-1] if values else None,
            "failedOrUnconfirmed": len(rows)-len(success), "missingSuccessfulMeasurement": len(success)-len(values)}


def main(args):
    sys.path.insert(0, "/terminal-client")
    from compute import run as compute

    folder = args.output
    folder.mkdir(parents=True, exist_ok=False)  # Never overwrite a previous experiment or silently resume its clock.
    settings = dict(line.split("=", 1) for line in args.settings.read_text().splitlines() if "=" in line and not line.startswith("#"))
    basic = base64.b64encode((settings["BACKEND_USER"]+":"+settings["BACKEND_PASSWORD"]).encode()).decode()
    terminal = json.loads(args.terminal.read_text())
    def api(path, body=None, method=None):
        request = urllib.request.Request(args.backend+"/api/namespaces/lab/"+path, method=method,
            headers={"Authorization":"Basic "+basic, "Content-Type":"application/json"},
            data=None if body is None else json.dumps(body).encode())
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    def samples():
        rows = []
        while True:
            batch = api("offloading/samples?limit=100&offset="+str(len(rows)))
            rows.extend(batch)
            if len(batch)<100: return rows
    def persist(name, value):
        (folder/name).write_text(json.dumps(value, indent=2, allow_nan=False))
    def save_policy(name, offload):
        flow = json.loads(json.dumps(base_flow))
        flow["id"] = name
        flow["description"] = "OFF-04 measured Double DQN pilot; synthetic signal, not a performance claim"
        flow["tasks"][0]["container"]["offload"] = offload
        return api("edge/policies/"+name, {"clusterId":"edge-a","eventType":name,"enabled":True,
            "expectedRevision":0,"source":json.dumps(flow)}, "PUT")
    base_flow = json.loads(api("edge/policies/offload-terminal")["flow"]["source"])
    prototype = base_flow["tasks"][0]["container"]
    for event in ("offload-edge", "offload-cloud", "offload-rule"):
        candidate = json.loads(api("edge/policies/"+event)["flow"]["source"])["tasks"][0]["container"]
        assert {k:v for k,v in candidate.items() if k!="offload"} == {k:v for k,v in prototype.items() if k!="offload"}, "baseline algorithms differ"
    manifest = json.loads(args.manifest.read_text())
    raw = (args.data/manifest["fileId"]).read_bytes()
    files = {}
    for multiplier in (1, 4, 16):
        file_id = str(uuid.uuid4())
        path = args.data/file_id
        with path.open("xb") as target: target.write(raw*multiplier)
        files[multiplier] = path
    run_id = str(uuid.uuid4())
    initial_version = "off04-exploration-"+run_id[:8]
    trained_version = "off04-trained-"+run_id[:8]
    schedule = [1,4,16,1,16,4]
    config = {"runId":run_id,"createdAt":time.time(),"trainingRequests":48,"evaluationRepeats":2,
        "multipliers":schedule,"pairOffsetsSeconds":[0,.25],"pairDrain":True,"initialModel":initial_version,
        "trainedModel":trained_version,"trainingUpdates":1000,"seed":17,"gamma":.95,
        "algorithm":prototype,"files":{str(k):{"fileId":v.name,"bytes":v.stat().st_size} for k,v in files.items()},
        "metric":"terminal POST-before to parsed result; mean/P95 successful measured requests, all failures counted",
        "scope":"single-host bounded pilot, no guarantee of DQN improvement"}
    order = ["TERMINAL","EDGE","CLOUD","RULE","DQN"]
    rng = random.Random(29)
    orders = []
    for _ in range(2):
        shuffled = list(order); rng.shuffle(shuffled); orders.append(shuffled)
    config["evaluationOrder"] = orders
    persist("plan.json",config)  # Freeze plan before collecting or inspecting any results.
    api("offloading/models/"+initial_version,export(network()),"PUT")
    save_policy("off04-train",{"strategy":"DQN","modelVersion":initial_version,"exploration":1})
    for method in ("TERMINAL","EDGE","CLOUD","RULE"):
        save_policy("off04-"+method.lower(),{"strategy":"RULE"} if method=="RULE" else {"strategy":"FIXED","layer":method})
    all_rows = []
    def execute(phase, method, event, index, multiplier, delay=0):
        time.sleep(delay)
        receipt = folder/f"{phase}-{method}-{index}.json"
        error = None
        try: compute(terminal,event,files[multiplier],receipt)
        except Exception as failure: error=type(failure).__name__
        saved = json.loads(receipt.read_text()) if receipt.exists() else {}
        result = saved.get("response") or {}
        success = result.get("state")=="SUCCESS"
        if success:
            output=result.get("result") or {}
            for key in ("samples","windows","alert_windows"):
                if output.get(key)!=manifest["expected"][key]*multiplier: raise AssertionError("incorrect algorithm output: "+key)
            for key in ("mean","rms","peak"):
                if not math.isclose(output.get(key,float("nan")),manifest["expected"][key],rel_tol=1e-8,abs_tol=1e-8): raise AssertionError("incorrect algorithm output: "+key)
        measured = saved.get("feedbackAccepted") and (saved.get("feedback") or {}).get("elapsedSeconds")
        return {"phase":phase,"method":method,"index":index,"multiplier":multiplier,"executionId":saved.get("executionId"),
            "success":success,"elapsedSeconds":measured if measured else None,"error":error,"receipt":receipt.name}
    def wave(phase, method, event, sequence):
        rows=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for start in range(0,len(sequence),2):
                pending=[pool.submit(execute,phase,method,event,i,sequence[i],(i-start)*.25) for i in range(start,min(start+2,len(sequence)))]
                rows.extend(p.result() for p in pending)
                persist(phase+"-"+method+"-requests.json",rows)
        all_rows.extend(rows)
        print(json.dumps({"phase":phase,"method":method,**summary(rows)}),flush=True)
        return rows
    # Existing OFF-03 history supplies actual transfer calibration; warm each actual baseline path equally.
    for method in ("TERMINAL","EDGE","CLOUD"):
        wave("warmup",method,"off04-"+method.lower(),[1,1])
    training = wave("training","exploration","off04-train",schedule*8)
    ids = {r["executionId"] for r in training if r["executionId"]}
    training_samples = [s for s in samples() if s["executionId"] in ids]
    persist("training-samples.json",training_samples)
    model, report = fit(training_samples,updates=1000,seed=17)
    persist("trained-model.json",model); persist("training-report.json",report)
    api("offloading/models/"+trained_version,model,"PUT")
    save_policy("off04-dqn",{"strategy":"DQN","modelVersion":trained_version,"exploration":0})
    evaluation=[]
    for repeat, methods in enumerate(orders):
        for method in methods:
            event="off04-dqn" if method=="DQN" else "off04-"+method.lower()
            evaluation.extend(wave("evaluation"+str(repeat),method,event,schedule))
    records=samples(); indexed={s["executionId"]:s for s in records}
    for row in all_rows:
        sample=indexed.get(row["executionId"])
        if sample:
            row["action"]=sample["target"]["kind"]
            if row["elapsedSeconds"] is not None:
                assert math.isclose(row["elapsedSeconds"],sample["measurement"]["elapsedSeconds"],rel_tol=1e-10)
            if row["method"] in ("TERMINAL","EDGE","CLOUD"): assert row["action"]==row["method"]
            if row["method"]=="DQN": assert sample["strategy"]=="DQN" and sample["modelVersion"]==trained_version
    assert not ids.intersection(r["executionId"] for r in evaluation), "training/evaluation leakage"
    results={method:summary([r for r in evaluation if r["method"]==method]) for method in order}
    persist("requests.json",all_rows)
    persist("evaluation-samples.json",[s for s in records if s["executionId"] in {r["executionId"] for r in evaluation}])
    persist("comparison.json",{"result":"COMPLETED","runId":run_id,"training":report,"methods":results,
        "actionCounts":{m:{a:sum(r.get("action")==a for r in evaluation if r["method"]==m) for a in ("TERMINAL","EDGE","CLOUD")} for m in order}})
    print(json.dumps(results,indent=2),flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings",type=Path,default=Path("/run/secrets/cea.env"))
    parser.add_argument("--terminal",type=Path,default=Path("/run/secrets/terminal.json"))
    parser.add_argument("--backend",default="http://backend:18085")
    parser.add_argument("--manifest",type=Path,default=Path("/manifest.json"))
    parser.add_argument("--data",type=Path,default=Path("/data"))
    parser.add_argument("--output",type=Path,required=True)
    main(parser.parse_args())

"""Bounded validation-only screening, NOT a CEA end-to-end benchmark."""
import argparse
import json
from pathlib import Path
import time

import torch
import fedcads
import model as avg


def run(root, output, rounds):
    torch.set_num_threads(1)
    raw = [avg.load(root / f"edge-{c}.pt") for c in "abc"]
    train, validation = [], []
    for i, data in enumerate(raw):
        order = torch.randperm(len(data["y"]), generator=torch.Generator().manual_seed(314159+i))
        held = order[:len(order)//10]
        kept = order[len(order)//10:]
        train.append({**data, "x":data["x"][kept], "y":data["y"][kept]})
        validation.append({"x":data["x"][held], "y":data["y"][held]})
    valid = {k:torch.cat([d[k] for d in validation]) for k in ("x","y")}
    clients = [{"id":f"edge-{c}","weight":len(d["y"])} for c,d in zip("abc",train)]
    protocol = {"targetAccuracy":0.90,"maxRounds":rounds,"seed":13,"model":"mlp",
        "batchSize":128,"localEpochs":1,"learningRates":[0.01,0.03,0.1],
        "cadsAlpha":0.001,"cadsRhos":[0.1,0.5],"validationSeed":314159,
        "trainingSamples":[len(d["y"]) for d in train],"validationSamples":len(valid["y"]),
        "formalSeeds":[31,41,51,61,71],"improvementTarget":0.25,
        "scope":"sequential cached numerical screening; official test file is never loaded"}
    output.mkdir(parents=True,exist_ok=True)
    (output/"protocol.json").write_text(json.dumps(protocol,indent=2))
    records=[]
    for lr in protocol["learningRates"]:
        for algorithm,rho in [("fedavg",None),("fedcads",0.1),("fedcads",0.5)]:
            torch.manual_seed(13)
            original = avg.build_model("mnist","mlp").state_dict()
            if algorithm=="fedavg":
                state={"algorithm":algorithm,"dataset":"mnist","model":"mlp","round":0,"state":original}
            else:
                state=fedcads.initialize("mnist","mlp",clients,13,rounds)
                assert all(torch.equal(state["state"]["base."+k],v) for k,v in original.items())
            rows=[]
            started=time.perf_counter()
            for round_number in range(rounds):
                updates=[]
                for client,data in zip(clients,train):
                    if algorithm=="fedcads":
                        update=fedcads.train(state,data,client["id"],1,128,lr,0.001,13)
                    else:
                        network=avg.checked_model(state)
                        avg.train(network,data,1,128,lr,0,13+round_number)
                        update={"algorithm":algorithm,"dataset":"mnist","model":"mlp","round":round_number+1,
                            "baseRound":round_number,"clientId":client["id"],"samples":len(data["y"]),"state":network.state_dict()}
                    updates.append(update)
                state=fedcads.aggregate(state,updates,rho) if algorithm=="fedcads" else avg.aggregate(updates)
                network=fedcads.checked_model(state) if algorithm=="fedcads" else avg.checked_model(state)
                score=avg.evaluate(network,valid,128)
                rows.append({"round":round_number+1,"accuracy":score["accuracy"],"seconds":time.perf_counter()-started})
                print(json.dumps({"lr":lr,"algorithm":algorithm,"rho":rho,**rows[-1]}),flush=True)
            records.append({"lr":lr,"algorithm":algorithm,"rho":rho,"rows":rows})
            (output/"screen.json").write_text(json.dumps(records,indent=2))


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--data",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--rounds",type=int,default=12)
    args=parser.parse_args()
    run(args.data,args.output,args.rounds)

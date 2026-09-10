"""Local-file CLI for ordinary Application tasks; storage is owned by the backend."""
import argparse
import json
import os
from pathlib import Path

import torch
from model import aggregate, build_model, checked_model, check_data, evaluate, load, train


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["init", "train", "aggregate", "evaluate"])
    parser.add_argument("--input", default="/cea-work/in/global_model")
    parser.add_argument("--clients-manifest")
    parser.add_argument("--output", default="/cea-work/out/model.pt")
    args = parser.parse_args()
    if args.stage == "init":
        algorithm = os.environ["ALGORITHM"]
        if algorithm not in ("fedavg", "fedprox"):
            raise ValueError("ALGORITHM must be fedavg or fedprox")
        torch.manual_seed(int(os.environ["SEED"]))
        dataset, name = os.environ["DATASET_NAME"], os.environ["MODEL"]
        result = {"algorithm": algorithm, "dataset": dataset, "model": name, "round": 0,
                  "state": build_model(dataset, name).state_dict()}
    elif args.stage == "aggregate":
        paths = json.loads(Path(args.clients_manifest).read_text())
        if not isinstance(paths, list) or not paths or not all(isinstance(path, str) for path in paths):
            raise ValueError("client manifest must be a non-empty array of local file paths")
        result = aggregate([load(path) for path in paths])
    else:
        previous = load(args.input)
        model = checked_model(previous)
        data = load(os.environ["DATASET_PATH" if args.stage == "train" else "TEST_DATASET_PATH"])
        check_data(data, previous)
        if data["split"] != ("train" if args.stage == "train" else "test"):
            raise ValueError("training and global test datasets must not be interchanged")
        if args.stage == "evaluate":
            result = evaluate(model, data, int(os.environ["BATCH_SIZE"]))
            result.update(round=previous["round"], algorithm=previous["algorithm"])
            Path(args.output).write_text(json.dumps(result, allow_nan=False))
            print(json.dumps(result, allow_nan=False), flush=True)
            return
        algorithm = os.environ["ALGORITHM"]
        if previous["algorithm"] != algorithm:
            raise ValueError("client algorithm does not match global model")
        mu = float(os.environ["PROX_MU"]) if algorithm == "fedprox" else 0.0
        train(model, data, int(os.environ["LOCAL_EPOCHS"]), int(os.environ["BATCH_SIZE"]),
              float(os.environ["LEARNING_RATE"]), mu,
              int(os.environ["SEED"]) + previous["round"])
        result = {key: previous[key] for key in ("algorithm", "dataset", "model")}
        result.update(round=previous["round"] + 1, baseRound=previous["round"],
                      clientId=os.environ["CLIENT_ID"], samples=len(data["y"]),
                      state=model.state_dict())
    torch.save(result, args.output)
    print(json.dumps({key: value for key, value in result.items() if key != "state"}), flush=True)


if __name__ == "__main__":
    main()

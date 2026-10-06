"""GFed-HSAM Application CLI; no storage credentials or platform dependencies."""
import argparse
import json
import os
from pathlib import Path

import torch

import gfed_hsam
from model import check_data, checked_model, dataset_from_refs, evaluate, load


def run(args, measurement):
    def read(path):
        with measurement.input(path):
            return load(path)

    if args.stage == "init":
        result = gfed_hsam.initialize(
            dataset_from_refs(os.environ["TRAINING_DATASET"], os.environ["TEST_DATASET"]),
            os.environ["MODEL"], json.loads(os.environ["CLIENTS"]), int(os.environ["SEED"]))
    elif args.stage == "aggregate":
        paths = json.loads(Path(args.clients_manifest).read_text())
        result = gfed_hsam.aggregate(read(args.input), [read(path) for path in paths], float(os.environ["RHO_0"]))
    else:
        previous = read(args.input)
        if previous["algorithm"] != "gfed-hsam":
            raise ValueError("GFed-HSAM requires its own global model")
        data = read(os.environ["DATASET_PATH" if args.stage == "train" else "TEST_DATASET_PATH"])
        check_data(data, previous)
        if data["split"] != ("train" if args.stage == "train" else "test"):
            raise ValueError("training and global test datasets must not be interchanged")
        if args.stage == "evaluate":
            result = evaluate(checked_model(previous), data, int(os.environ["BATCH_SIZE"]))
            result.update(round=previous["round"], algorithm="gfed-hsam")
            Path(args.output).write_text(json.dumps(result, allow_nan=False))
            measurement.output(args.output)
            print(json.dumps(result, allow_nan=False), flush=True)
            return
        result = gfed_hsam.train(previous, data, os.environ["CLIENT_ID"], int(os.environ["LOCAL_EPOCHS"]),
                                 int(os.environ["BATCH_SIZE"]), float(os.environ["LEARNING_RATE"]),
                                 float(os.environ["PHI"]), float(os.environ["RHO_0"]), float(os.environ["RHO_1"]),
                                 float(os.environ["HSAM_ALPHA"]), float(os.environ["HSAM_BETA"]),
                                 float(os.environ["HSAM_GAMMA"]), int(os.environ["SEED"]))
    torch.save(result, args.output)
    measurement.output(args.output)
    print(json.dumps({key: result[key] for key in ("algorithm", "dataset", "model", "round")}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["init", "train", "aggregate", "evaluate"])
    parser.add_argument("--input", default="/cea-work/in/global_model")
    parser.add_argument("--clients-manifest")
    parser.add_argument("--output", default="/cea-work/out/model.pt")
    from cea_measurement import Measurement, REPORT_NAME
    args = parser.parse_args()
    with Measurement(Path(args.output).parent / REPORT_NAME) as report:
        run(args, report)


if __name__ == "__main__":
    main()

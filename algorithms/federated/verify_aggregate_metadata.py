"""Run inside the immutable par08 image with this directory mounted at /candidate.
Checks the new aggregate against the original image implementation; no platform reports.
"""
import importlib.util
import json
import sys

import torch

spec = importlib.util.spec_from_file_location("legacy", "/app/model.py")
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
spec = importlib.util.spec_from_file_location("candidate", "/candidate/model.py")
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)
torch.set_num_threads(1)
cases = 0
tensors = 0
for dataset in ("mnist", "cifar10", "cifar100"):
    for model in ("mlp", "cnn"):
        for algorithm in ("fedavg", "fedprox"):
            for count in (1, 6, 9, 18):
                torch.manual_seed(13)
                updates = [{"algorithm": algorithm, "dataset": dataset, "model": model,
                            "round": 2, "baseRound": 1, "clientId": str(i), "samples": 11 + i,
                            "state": legacy.build_model(dataset, model).state_dict()} for i in range(count)]
                expected, actual = legacy.aggregate(updates), candidate.aggregate(updates)
                assert expected.keys() == actual.keys()
                for key, value in expected.items():
                    if key == "state":
                        assert value.keys() == actual[key].keys()
                        for name, weight in value.items():
                            assert torch.equal(weight, actual[key][name]), (dataset, model, algorithm, count, name)
                            tensors += 1
                    else:
                        assert value == actual[key]
                cases += 1
print(json.dumps({"result": "PASS", "cases": cases, "exactTensors": tensors,
                  "reference": "/app/model.py in cea/federated:par08-v1"}))

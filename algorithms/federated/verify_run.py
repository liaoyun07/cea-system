"""Independent numerical audit of files exported by the Java integration test."""
import argparse
import json
from pathlib import Path

import torch
from model import checked_model, evaluate, load, train


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("algorithm", choices=["fedavg", "fedprox"])
    parser.add_argument("--clients", nargs="+", default=list("abc"))
    args = parser.parse_args()
    root = Path(args.directory)
    shards = [load(root / f"edge-{letter}.pt") for letter in args.clients]
    indices = torch.cat([shard["indices"] for shard in shards])
    expected_samples = sum(len(shard["y"]) for shard in shards)
    assert len(indices.unique()) == len(indices) == expected_samples
    assert all(shard["split"] == "train" for shard in shards)
    assert load(root / "test.pt")["split"] == "test"
    previous = load(root / "init.pt")
    assert previous["round"] == 0 and previous["algorithm"] == args.algorithm
    report = []
    for round_no in (1, 2):
        updates = [load(root / f"client-{letter}-r{round_no}.pt") for letter in args.clients]
        total = sum(u["samples"] for u in updates)
        merged = load(root / f"aggregate-r{round_no}.pt")
        assert merged["round"] == round_no and merged["algorithm"] == args.algorithm
        assert total == expected_samples and [u["samples"] for u in updates] == [len(s["y"]) for s in shards]
        for letter, update in zip(args.clients, updates):
            assert update["baseRound"] == round_no - 1 and update["round"] == round_no
            data = load(root / f"edge-{letter}.pt")
            expected = checked_model(previous)
            train(expected, data, 1, 32, 0.01, 0.1 if args.algorithm == "fedprox" else 0,
                  13 + round_no - 1)
            for key, value in expected.state_dict().items():
                torch.testing.assert_close(update["state"][key], value, rtol=1e-5, atol=1e-6)
        for key, value in merged["state"].items():
            expected = sum(u["state"][key].double() * u["samples"] for u in updates) / total
            torch.testing.assert_close(value.double(), expected, rtol=1e-5, atol=1e-6)
        assert any(not torch.equal(v, previous["state"][k]) for k, v in merged["state"].items())
        metrics = json.loads((root / f"evaluate-r{round_no}.json").read_text())
        reference = evaluate(checked_model(merged), load(root / "test.pt"), 32)
        assert metrics["round"] == round_no and metrics["algorithm"] == args.algorithm
        assert metrics["samples"] == 256
        assert abs(metrics["loss"] - reference["loss"]) < 1e-6
        assert metrics["accuracy"] == reference["accuracy"]
        report.append(metrics)
        previous = merged
    print(json.dumps({"algorithm": args.algorithm, "rounds": report, "numericalAudit": "PASS"}))


if __name__ == "__main__":
    main()

"""Prepare genuine MNIST train shards and a separate global test file, outside task execution."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import urllib.request

import numpy as np
import torch


# Original MNIST resource checksums, also published by torchvision v0.17.2.
CHECKSUMS = {
    "train-images-idx3-ubyte.gz": "f68b3c2dcbeaaa9fbdd348bbdeb94873",
    "train-labels-idx1-ubyte.gz": "d53e105ee54ea40749a09fcbcd1e9432",
    "t10k-images-idx3-ubyte.gz": "9fb629c4189551a2d022fa330f9573f3",
    "t10k-labels-idx1-ubyte.gz": "ec29112dd5afa0611ce80d1b7f02629c",
}


def idx(root, name, magic):
    path = root / name
    if not path.exists():
        with urllib.request.urlopen("https://storage.googleapis.com/cvdf-datasets/mnist/" + name,
                                    timeout=60) as response:
            downloaded = response.read()
        if hashlib.md5(downloaded, usedforsecurity=False).hexdigest() != CHECKSUMS[name]:
            raise ValueError("MNIST download checksum mismatch")
        path.write_bytes(downloaded)
    compressed = path.read_bytes()
    if hashlib.md5(compressed, usedforsecurity=False).hexdigest() != CHECKSUMS[name]:
        raise ValueError("MNIST cached file checksum mismatch")
    raw = gzip.decompress(compressed)
    actual, count = struct.unpack(">II", raw[:8])
    if actual != magic:
        raise ValueError("invalid MNIST IDX header")
    offset, shape = (16, (count, 28, 28)) if magic == 2051 else (8, (count,))
    return torch.from_numpy(np.frombuffer(raw[offset:], dtype=np.uint8).copy().reshape(shape))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--train-samples", type=int, default=60000)
    parser.add_argument("--test-samples", type=int, default=10000)
    args = parser.parse_args()
    if not 6 <= args.train_samples <= 60000 or not 1 <= args.test_samples <= 10000:
        raise ValueError("sample counts exceed real MNIST splits or are too small")
    root = Path(args.output)
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    train_x = idx(raw, "train-images-idx3-ubyte.gz", 2051)
    train_y = idx(raw, "train-labels-idx1-ubyte.gz", 2049)
    test_x = idx(raw, "t10k-images-idx3-ubyte.gz", 2051)
    test_y = idx(raw, "t10k-labels-idx1-ubyte.gz", 2049)
    # Deterministic non-IID, disjoint shards of unequal size exercise weighted aggregation.
    selected = torch.randperm(len(train_y), generator=torch.Generator().manual_seed(13))[:args.train_samples]
    selected = selected[torch.argsort(train_y[selected], stable=True)]
    cuts = (0, args.train_samples // 6, args.train_samples // 2, args.train_samples)
    counts = {}
    for index, client in enumerate(("edge-a", "edge-b", "edge-c")):
        indices = selected[cuts[index]:cuts[index + 1]]
        payload = {"dataset": "mnist", "split": "train", "indices": indices,
                   "x": (train_x[indices].float().unsqueeze(1) / 255 - 0.1307) / 0.3081,
                   "y": train_y[indices].long()}
        torch.save(payload, root / (client + ".pt"))
        counts[client] = len(indices)
    torch.save({"dataset": "mnist", "split": "test",
                "indices": torch.arange(args.test_samples),
                "x": (test_x[:args.test_samples].float().unsqueeze(1) / 255 - 0.1307) / 0.3081,
                "y": test_y[:args.test_samples].long()}, root / "test.pt")
    manifest = {"source": "https://storage.googleapis.com/cvdf-datasets/mnist/",
                "dataset": "MNIST", "trainSamples": counts, "testSamples": args.test_samples,
                "partition": "label-sorted disjoint shards in proportions 1:2:3", "seed": 13}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()

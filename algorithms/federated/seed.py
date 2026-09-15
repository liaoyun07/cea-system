"""Prepare genuine image datasets outside task execution; no generated-data fallback."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import shutil
import tarfile
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

# Binary archive checksums and layouts: https://www.cs.toronto.edu/~kriz/cifar.html
CIFAR = {
    "cifar10": ("cifar-10-binary.tar.gz", "c32a1d4ab5d03f1284b67883e8d87530",
                "cifar-10-batches-bin", [f"data_batch_{i}.bin" for i in range(1, 6)], "test_batch.bin", 1, 10),
    "cifar100": ("cifar-100-binary.tar.gz", "03b5dce01913d631647c71ecec9e9cb8",
                 "cifar-100-binary", ["train.bin"], "test.bin", 2, 100),
}


def cifar_records(raw, label_bytes, classes, expected_count):
    if len(raw) != expected_count * (3072 + label_bytes):
        raise ValueError("invalid CIFAR binary record length")
    records = np.frombuffer(raw, dtype=np.uint8).reshape(expected_count, 3072 + label_bytes)
    # CIFAR-100 has coarse then fine labels; classification uses the 100 fine classes.
    labels = records[:, label_bytes - 1].copy()
    if int(labels.max()) >= classes:
        raise ValueError("invalid CIFAR class label")
    images = records[:, label_bytes:].copy().reshape(-1, 3, 32, 32)
    return torch.from_numpy(images), torch.from_numpy(labels)


def cifar(root, dataset):
    filename, checksum, folder, train_names, test_name, label_bytes, classes = CIFAR[dataset]
    path = root / filename
    if not path.exists():
        partial = path.with_suffix(".part")
        try:
            with urllib.request.urlopen("https://cave.cs.toronto.edu/kriz/" + filename, timeout=60) as response, partial.open("wb") as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
            with partial.open("rb") as source:
                if hashlib.file_digest(source, "md5").hexdigest() != checksum:
                    raise ValueError("CIFAR download checksum mismatch")
            partial.replace(path)
        finally:
            partial.unlink(missing_ok=True)
    with path.open("rb") as source:
        if hashlib.file_digest(source, "md5").hexdigest() != checksum:
            raise ValueError("CIFAR cached file checksum mismatch")
    with tarfile.open(path, "r:gz") as archive:
        def read(name, count):
            member = archive.getmember(folder + "/" + name)
            if not member.isfile() or member.size != count * (3072 + label_bytes):
                raise ValueError("invalid CIFAR archive member")
            with archive.extractfile(member) as source:
                return cifar_records(source.read(), label_bytes, classes, count)
        batches = [read(name, 50000 // len(train_names)) for name in train_names]
        test_x, test_y = read(test_name, 10000)
    return torch.cat([x for x, _ in batches]), torch.cat([y for _, y in batches]), test_x, test_y


def normalized(images, dataset):
    if dataset == "mnist":
        return (images.float().unsqueeze(1) / 255 - 0.1307) / 0.3081
    # Fixed per-channel [-1, 1] scaling, without fitting statistics on the test split.
    return (images.float() / 255 - 0.5) / 0.5


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
    parser.add_argument("--dataset", choices=["mnist", "cifar10", "cifar100"], default="mnist")
    parser.add_argument("--train-samples", type=int)
    parser.add_argument("--test-samples", type=int, default=10000)
    args = parser.parse_args()
    train_limit = 60000 if args.dataset == "mnist" else 50000
    if args.train_samples is None:
        args.train_samples = train_limit
    if not 6 <= args.train_samples <= train_limit or not 1 <= args.test_samples <= 10000:
        raise ValueError("sample counts exceed real dataset splits or are too small")
    root = Path(args.output)
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    if args.dataset == "mnist":
        train_x = idx(raw, "train-images-idx3-ubyte.gz", 2051)
        train_y = idx(raw, "train-labels-idx1-ubyte.gz", 2049)
        test_x = idx(raw, "t10k-images-idx3-ubyte.gz", 2051)
        test_y = idx(raw, "t10k-labels-idx1-ubyte.gz", 2049)
    else:
        train_x, train_y, test_x, test_y = cifar(raw, args.dataset)
    # Deterministic non-IID, disjoint shards of unequal size exercise weighted aggregation.
    selected = torch.randperm(len(train_y), generator=torch.Generator().manual_seed(13))[:args.train_samples]
    selected = selected[torch.argsort(train_y[selected], stable=True)]
    cuts = (0, args.train_samples // 6, args.train_samples // 2, args.train_samples)
    counts = {}
    for index, client in enumerate(("edge-a", "edge-b", "edge-c")):
        indices = selected[cuts[index]:cuts[index + 1]]
        payload = {"dataset": args.dataset, "split": "train", "indices": indices,
                   "x": normalized(train_x[indices], args.dataset),
                   "y": train_y[indices].long()}
        torch.save(payload, root / (client + ".pt"))
        counts[client] = len(indices)
    torch.save({"dataset": args.dataset, "split": "test",
                "indices": torch.arange(args.test_samples),
                "x": normalized(test_x[:args.test_samples], args.dataset),
                "y": test_y[:args.test_samples].long()}, root / "test.pt")
    manifest = {"source": "https://storage.googleapis.com/cvdf-datasets/mnist/" if args.dataset == "mnist" else "https://cave.cs.toronto.edu/kriz/" + CIFAR[args.dataset][0],
                "dataset": args.dataset, "trainSamples": counts, "testSamples": args.test_samples,
                "partition": "label-sorted disjoint shards in proportions 1:2:3", "seed": 13}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()

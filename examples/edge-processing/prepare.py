"""Offline, reproducible preparation. Downloads stay outside Git and task images."""
import argparse
import concurrent.futures
import io
import json
import tarfile
import urllib.request
import zipfile
from pathlib import Path

import joblib
import numpy as np
from scipy.io import loadmat
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, roc_auc_score

from app import anomaly, backbone, embedding, features, image_tensor, write_json


def download(url, path):
    if not path.exists():
        partial = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(url, timeout=90) as source, partial.open("wb") as output:
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
        partial.replace(path)
    return path


def hydraulic(root):
    with zipfile.ZipFile(root / "raw/hydraulic.zip") as data:
        result = {}
        for sensor in ("PS1", "FS1", "TS1"):
            with data.open(sensor + ".txt") as file:
                result[sensor] = np.loadtxt(file, max_rows=10)
    np.savez_compressed(root / "terminal/hydraulic.npz", **result)
    write_json(root / "hydraulic-source.json", {"dataset": "UCI 447", "cycles": [0, 9],
        "rates_hz": {"PS1": 100, "FS1": 10, "TS1": 1}, "missing_values_in_original": False})


def bearing(root):
    # Official 0.007 inch, 6 o'clock outer fault series; 0/1/2 HP train, 3 HP test.
    files = {"normal": [97, 98, 99, 100], "inner": [105, 106, 107, 108],
             "ball": [118, 119, 120, 121], "outer": [130, 131, 132, 133]}
    urls = {n: f"https://engineering.case.edu/sites/default/files/{n}.mat" for v in files.values() for n in v}
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        list(pool.map(lambda n: download(urls[n], root / f"raw/{n}.mat"), urls))
    train_x, train_y, test_x, test_y, sources = [], [], [], [], []
    for label, numbers in files.items():
        for load, number in enumerate(numbers):
            data = loadmat(root / f"raw/{number}.mat")
            # Normal 99.mat also contains X098 fields: never consume the other experiment.
            fields = [k for k in data if k == f"X{number:03}_FE_time"]
            if len(fields) != 1:
                raise ValueError(f"expected fan-end signal in {number}: {fields}")
            signal = data[fields[0]].ravel()
            windows = signal[:len(signal) // 2048 * 2048].reshape(-1, 2048)
            x, y = (train_x, train_y) if load < 3 else (test_x, test_y)
            x.extend(windows)
            y.extend([label] * len(windows))
            sources.append({"file": number, "url": urls[number], "field": fields[0], "load_hp": load,
                            "split": "train" if load < 3 else "test", "windows": len(windows)})
    estimator = RandomForestClassifier(n_estimators=150, min_samples_leaf=2, random_state=13, n_jobs=2)
    estimator.fit(features(train_x), train_y)
    prediction = estimator.predict(features(test_x))
    joblib.dump(estimator, root / "models/bearing.joblib")
    # All held-out windows, including normal; labels deliberately not shipped to inference.
    np.savez_compressed(root / "terminal/bearing.npz", signal=np.array(test_x), sample_rate=12000)
    write_json(root / "bearing-evaluation.json", {"sensor": "fan-end", "sample_rate": 12000,
        "train_windows": len(train_y), "test_windows": len(test_y), "classes": estimator.classes_.tolist(),
        "accuracy": accuracy_score(test_y, prediction),
        "confusion_matrix": confusion_matrix(test_y, prediction, labels=estimator.classes_).tolist(),
        "sources": sources, "expected_predictions": prediction.tolist()})


def surface(root):
    import torch
    from torchvision.models import ResNet18_Weights
    torch.set_num_threads(2)
    network = backbone(ResNet18_Weights.IMAGENET1K_V1)
    indices = np.random.default_rng(13).permutation(448)[:32]
    # Decode XZ once; random access inside a compressed tar otherwise repeatedly decompresses it.
    cache = root / "raw/tile-images.zip"
    if not cache.exists():
        partial = cache.with_suffix(".part")
        with tarfile.open(root / "raw/tile.tar.xz", mode="r|xz") as source, zipfile.ZipFile(partial, "w") as target:
            for member in source:
                if member.isfile() and member.name.endswith(".png"):
                    target.writestr(member.name, source.extractfile(member).read())
        partial.replace(cache)
    with zipfile.ZipFile(cache) as archive:
        members = sorted(archive.namelist())
        normal = [m for m in members if "/train/good/" in "/" + m]
        test = [m for m in members if "/test/" in "/" + m]
        shuffled = np.random.default_rng(13).permutation(len(normal))
        split = int(len(normal) * .8)
        train, calibration = [normal[i] for i in shuffled[:split]], [normal[i] for i in shuffled[split:]]
        if min(len(train), len(calibration), len(test)) == 0:
            raise ValueError("missing expected MVTec split")
        samples = np.stack([embedding(network, image_tensor(archive.read(m)), indices).numpy()[0]
                            .reshape(32, -1).T for m in train])
        mean = samples.mean(axis=0)
        delta = samples - mean
        covariance = np.einsum("npi,npj->pij", delta, delta) / (len(train) - 1)
        inverse = np.linalg.inv(covariance + .01 * np.eye(32)[None, :, :])
        state = {"indices": indices, "mean": mean, "inverse": inverse, "backbone": network.state_dict()}
        calibration_scores = [anomaly(network, state, archive.read(m))[0] for m in calibration]
        state["threshold"] = float(np.quantile(calibration_scores, .95))
        torch.save(state, root / "models/tile.pt")
        labels, scores = [], []
        for member in test:
            labels.append("/good/" not in member)
            scores.append(anomaly(network, state, archive.read(member))[0])
        # One normal plus one defect from each official test category, no label-based score cherry picking.
        categories = sorted({m.rsplit("/", 2)[-2] for m in test})
        selected = [next(m for m in test if m.rsplit("/", 2)[-2] == c) for c in categories]
        with zipfile.ZipFile(root / "terminal/surface.zip", "w", zipfile.ZIP_STORED) as batch:
            for i, member in enumerate(selected):
                batch.writestr(f"{i:03}.png", archive.read(member))
        write_json(root / "surface-evaluation.json", {"algorithm": "PaDiM simplified CPU r18/128px/32dims",
            "train": train, "calibration": calibration,
            "test_images": len(test), "auroc": roc_auc_score(labels, scores), "threshold": state["threshold"],
            "threshold_accuracy": accuracy_score(labels, np.array(scores) > state["threshold"]),
            "test": [{"file": m, "label": label, "score": score} for m, label, score in zip(test, labels, scores)],
            "replay": selected})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["hydraulic", "bearing", "surface", "all"])
    parser.add_argument("--root", type=Path, default=Path("/data"))
    args = parser.parse_args()
    for folder in ("raw", "models", "terminal", "evidence"):
        (args.root / folder).mkdir(parents=True, exist_ok=True)
    for name, prepare in (("hydraulic", hydraulic), ("bearing", bearing), ("surface", surface)):
        if args.kind in (name, "all"):
            prepare(args.root)
            print(name + " prepared", flush=True)

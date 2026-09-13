"""Actual edge processing. Local files only; object transport belongs to the file helper."""
import argparse
import io
import json
import zipfile
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.stats import kurtosis


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False))


def load_samples(source):
    with zipfile.ZipFile(source) as archive:
        if len(archive.infolist()) > 8 or sum(m.file_size for m in archive.infolist()) > 128 * 1024 * 1024:
            raise ValueError("sample archive exceeds limit")
    return np.load(source, allow_pickle=False)


def hydraulic(source, output):
    # Native sample rates are part of the source format, not inferred from file size.
    rates = {"PS1": 100, "FS1": 10, "TS1": 1}
    summaries, cleaned, missing = [], {}, 0
    with load_samples(source) as data:
        cycle_count = None
        for name, rate in rates.items():
            values = np.array(data[name], dtype=np.float64)
            if values.ndim != 2 or values.shape[1] != 60 * rate or not 1 <= len(values) <= 100:
                raise ValueError("expected 1..100 native-rate 60-second cycles")
            if cycle_count is not None and len(values) != cycle_count:
                raise ValueError("sensor cycle counts differ")
            cycle_count = len(values)
            for cycle, row in enumerate(values):
                valid = np.isfinite(row)
                missing += int((~valid).sum())
                if not valid.any():
                    raise ValueError("entire cycle missing")
                row[~valid] = np.interp(np.flatnonzero(~valid), np.flatnonzero(valid), row[valid])
                for window, samples in enumerate(row.reshape(6, 10 * rate)):
                    summaries.append({"sensor": name, "cycle": cycle, "window_seconds": window * 10,
                        "mean": float(samples.mean()), "min": float(samples.min()), "max": float(samples.max()),
                        "std": float(samples.std())})
            cleaned[name] = values
    np.savez_compressed(output / "cleaned.npz", **cleaned)
    write_json(output / "summary.json", {"source": "UCI hydraulic native-rate replay", "windows": summaries})
    write_json(output / "metrics.json", {"cycles": len(values), "windows": len(summaries), "imputed_samples": missing})


def features(signal):
    signal = np.asarray(signal, dtype=np.float64)
    if signal.ndim != 2 or signal.shape[1] != 2048 or not np.isfinite(signal).all():
        raise ValueError("expected finite 2048-sample vibration windows")
    centered = signal - signal.mean(axis=1, keepdims=True)
    rms = np.sqrt(np.mean(centered ** 2, axis=1))
    spectrum = abs(np.fft.rfft(centered * np.hanning(2048), axis=1)) ** 2
    bands = np.stack([p.sum(axis=1) for p in np.array_split(spectrum, 8, axis=1)], axis=1)
    bands /= np.maximum(bands.sum(axis=1, keepdims=True), 1e-20)
    result = np.column_stack([rms, kurtosis(centered, axis=1, fisher=False),
        np.max(abs(centered), axis=1) / np.maximum(rms, 1e-10), bands])
    if not np.isfinite(result).all():
        raise ValueError("undefined vibration features")
    return result


def bearing(source, model, output):
    import joblib
    # model is an administrator-prepared artifact, not supplied in the terminal request.
    estimator = joblib.load(model)
    with load_samples(source) as data:
        x = data["signal"]
        if int(data["sample_rate"]) != 12000 or not 1 <= len(x) <= 1000:
            raise ValueError("expected bounded 12kHz fan-end samples")
    probabilities = estimator.predict_proba(features(x))
    labels = estimator.classes_[probabilities.argmax(axis=1)]
    rows = [{"window": i, "class": str(label), "confidence": float(probabilities[i].max())}
            for i, label in enumerate(labels)]
    counts = {str(label): int(np.sum(labels == label)) for label in estimator.classes_}
    write_json(output / "diagnosis.json", {"model": "cwru-fe-rf-v1", "sensor": "fan-end", "sample_rate": 12000,
        "counts": counts, "windows": rows, "advice": "Review diagnostic evidence; no automatic actuator command."})
    write_json(output / "metrics.json", {"windows": len(rows), "fault_windows": int(np.sum(labels != "normal"))})


def backbone(weights=None):
    import torch
    from torchvision.models import resnet18
    network = resnet18(weights=weights)
    network.eval()
    for parameter in network.parameters():
        parameter.requires_grad_(False)
    return network


def embedding(network, pixels, indices):
    import torch
    import torch.nn.functional as functional
    with torch.no_grad():
        x = network.maxpool(network.relu(network.bn1(network.conv1(pixels))))
        a = network.layer1(x)
        b = network.layer2(a)
        c = network.layer3(b)
        return torch.cat([a, functional.interpolate(b, size=a.shape[-2:], mode="nearest"),
                             functional.interpolate(c, size=a.shape[-2:], mode="nearest")], dim=1)[:, indices]


def image_tensor(raw):
    import torch
    from PIL import Image
    with Image.open(io.BytesIO(raw)) as image:
        if image.width * image.height > 4_000_000:
            raise ValueError("image exceeds limit")
        values = np.array(image.convert("RGB").resize((128, 128)), dtype=np.float32) / 255
    values = (values - np.array([.485, .456, .406])) / np.array([.229, .224, .225])
    return torch.from_numpy(values.astype(np.float32).transpose(2, 0, 1)).unsqueeze(0)


def anomaly(network, state, raw):
    values = embedding(network, image_tensor(raw), state["indices"]).numpy()[0].reshape(32, -1).T
    delta = values - state["mean"]
    distance = np.sqrt(np.maximum(np.einsum("pi,pij,pj->p", delta, state["inverse"], delta), 0)).reshape(32, 32)
    heatmap = gaussian_filter(distance, sigma=1)
    return float(heatmap.max()), heatmap


def surface(source, model, output):
    import torch
    state = torch.load(model, map_location="cpu", weights_only=False)  # trusted registered model only
    network = backbone()
    network.load_state_dict(state["backbone"])
    rows = []
    with zipfile.ZipFile(source) as batch, zipfile.ZipFile(output / "heatmaps.zip", "w", zipfile.ZIP_DEFLATED) as maps:
        members = batch.infolist()
        if not 1 <= len(members) <= 64 or sum(m.file_size for m in members) > 128 * 1024 * 1024:
            raise ValueError("expected 1..64 bounded PNG images")
        for i, member in enumerate(members):
            if member.is_dir() or not member.filename.lower().endswith(".png") or member.file_size > 8 * 1024 * 1024:
                raise ValueError("PNG members only")
            score, heatmap = anomaly(network, state, batch.read(member))
            buffer = io.BytesIO()
            np.save(buffer, heatmap, allow_pickle=False)
            maps.writestr(f"{i:03}.npy", buffer.getvalue())
            rows.append({"image": i, "score": score, "defect": score > state["threshold"]})
    write_json(output / "inspection.json", {"model": "tile-padim-r18-v1", "threshold": state["threshold"], "images": rows})
    write_json(output / "metrics.json", {"images": len(rows), "defects": sum(r["defect"] for r in rows)})


def report(source, output):
    inspection = json.loads(Path(source).read_text())
    rows = inspection["images"]
    if not rows:
        raise ValueError("empty inspection")
    rejected = sum(row["defect"] for row in rows)
    write_json(output / "report.json", {"images": len(rows), "rejected": rejected,
        "rejection_ratio": rejected / len(rows), "model": inspection["model"],
        "max_anomaly_score": max(r["score"] for r in rows), "raw_images_transferred": False})
    write_json(output / "metrics.json", {"images": len(rows), "rejection_ratio": rejected / len(rows)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["hydraulic", "bearing", "surface", "report"])
    parser.add_argument("--input", default="/cea-work/in/data")
    parser.add_argument("--model", default="/cea-work/in/model")
    parser.add_argument("--output", type=Path, default=Path("/cea-work/out"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.operation == "hydraulic":
        hydraulic(args.input, args.output)
    elif args.operation == "bearing":
        bearing(args.input, args.model, args.output)
    elif args.operation == "surface":
        surface(args.input, args.model, args.output)
    else:
        report(args.input, args.output)

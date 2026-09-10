"""FedAvg/FedProx numerical core. No platform, network or telemetry dependencies."""
import math

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


def build_model(dataset, name):
    channels, size = {"mnist": (1, 28), "cifar10": (3, 32)}[dataset]
    if name == "mlp":
        return nn.Sequential(nn.Flatten(), nn.Linear(channels * size * size, 128),
                             nn.ReLU(), nn.Linear(128, 10))
    if name == "cnn":
        return nn.Sequential(
            nn.Conv2d(channels, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Flatten(), nn.Linear(32 * (size // 4) ** 2, 64), nn.ReLU(), nn.Linear(64, 10))
    raise ValueError("MODEL must be mlp or cnn")


def load(path):
    return torch.load(path, map_location="cpu", weights_only=True)


def checked_model(payload):
    model = build_model(payload["dataset"], payload["model"])
    model.load_state_dict(payload["state"], strict=True)
    if not all(torch.isfinite(value).all() for value in model.state_dict().values()):
        raise ValueError("model contains non-finite weights")
    return model


def check_data(data, model_payload):
    shape = {"mnist": (1, 28, 28), "cifar10": (3, 32, 32)}[model_payload["dataset"]]
    x, y = data["x"], data["y"]
    if data["dataset"] != model_payload["dataset"] or tuple(x.shape[1:]) != shape:
        raise ValueError("dataset does not match model")
    if not len(y) or len(x) != len(y) or y.ndim != 1 or y.dtype != torch.long:
        raise ValueError("dataset must contain nonempty matching images and labels")
    if not torch.isfinite(x).all() or int(y.min()) < 0 or int(y.max()) >= 10:
        raise ValueError("invalid dataset values")


def train(model, data, epochs, batch_size, learning_rate, mu, seed):
    if epochs < 1 or batch_size < 1 or not math.isfinite(learning_rate) or learning_rate <= 0:
        raise ValueError("epochs, batch size and learning rate must be positive")
    if not math.isfinite(mu) or mu < 0:
        raise ValueError("PROX_MU must be finite and non-negative")
    anchor = [p.detach().clone() for p in model.parameters()]
    loader = DataLoader(TensorDataset(data["x"], data["y"]), batch_size=batch_size,
                        shuffle=True, generator=torch.Generator().manual_seed(seed))
    model.train()
    optimizer = torch.optim.SGD(model.parameters(), lr=learning_rate)
    for _ in range(epochs):
        for x, y in loader:
            optimizer.zero_grad()
            objective = nn.functional.cross_entropy(model(x), y)
            if mu:
                objective = objective + mu / 2 * sum(
                    (p - initial).square().sum() for p, initial in zip(model.parameters(), anchor))
            objective.backward()
            optimizer.step()
    if not all(torch.isfinite(p).all() for p in model.parameters()):
        raise ValueError("training produced non-finite weights")


def aggregate(updates):
    if not updates:
        raise ValueError("at least one client update is required")
    first = updates[0]
    signature = ("algorithm", "dataset", "model", "round", "baseRound")
    clients = set()
    for update in updates:
        if any(update[key] != first[key] for key in signature):
            raise ValueError("mixed algorithms, models or rounds")
        if update["round"] != update["baseRound"] + 1 or update["samples"] <= 0:
            raise ValueError("invalid client round or sample count")
        if update["clientId"] in clients:
            raise ValueError("duplicate client update")
        clients.add(update["clientId"])
        checked_model(update)
    total = sum(update["samples"] for update in updates)
    state = {key: sum(update["state"][key] * (update["samples"] / total) for update in updates)
             for key in first["state"]}
    result = {key: first[key] for key in ("algorithm", "dataset", "model", "round")}
    result["state"] = state
    checked_model(result)
    return result


def evaluate(model, data, batch_size):
    if batch_size < 1:
        raise ValueError("batch size must be positive")
    model.eval()
    total_loss, correct = 0.0, 0
    with torch.no_grad():
        for x, y in DataLoader(TensorDataset(data["x"], data["y"]), batch_size=batch_size):
            prediction = model(x)
            total_loss += nn.functional.cross_entropy(prediction, y, reduction="sum").item()
            correct += int((prediction.argmax(1) == y).sum())
    return {"loss": total_loss / len(data["y"]), "accuracy": correct / len(data["y"]),
            "samples": len(data["y"])}

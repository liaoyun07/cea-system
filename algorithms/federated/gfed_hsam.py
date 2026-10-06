"""GFed-HSAM core on the platform's ordinary model/dataset/file protocol.

Paper equations 7-13 and Algorithm 1; executable conventions are documented in
docs/contracts/gfed-hsam.md. No synthetic gradients or simulated participation.
"""
import math

import torch
from torch.nn import functional as F
from torch.utils.data import DataLoader, TensorDataset

from model import build_model, checked_model


def flat(model):
    return torch.nn.utils.parameters_to_vector(model.parameters()).detach().clone()


def unit(vector):
    # Zero gradient has zero perturbation, including the SAM/SGD limiting case.
    return vector / vector.norm().clamp_min(1e-12)


def initialize(dataset, name, clients, seed):
    ids = [client["id"] for client in clients]
    if not ids or len(set(ids)) != len(ids) or any(not isinstance(i, str) or not i for i in ids):
        raise ValueError("CLIENTS must contain distinct non-empty ids")
    torch.manual_seed(seed)
    model = build_model(dataset, name)
    zero = torch.zeros_like(flat(model))
    return {"algorithm": "gfed-hsam", "dataset": dataset, "model": name, "round": 0,
            "state": model.state_dict(), "clients": ids,
            "clientDrift": {i: zero.clone() for i in ids},
            "perturbationDual": {i: zero.clone() for i in ids},
            "globalDrift": zero.clone(), "globalPerturbation": zero.clone()}


def hsam_gradient(model, x, y, global_perturbation, dual, rho0, rho1, alpha, beta, gamma):
    """Four real gradients on the SAME minibatch; restore unperturbed parameters.

    FedSMOO (paper reference 17) supplies the dual/global correction to local
    perturbation directions. Formula 12 is used literally for the final gradient;
    we do not invent the projection missing from the paper's equations.
    """
    base = flat(model)

    def gradient(vector):
        torch.nn.utils.vector_to_parameters(vector, model.parameters())
        gradients = torch.autograd.grad(F.cross_entropy(model(x), y), tuple(model.parameters()))
        return torch.cat([g.detach().reshape(-1) for g in gradients])

    g0 = gradient(base)
    s0 = rho0 * unit(g0 - dual - global_perturbation)
    g1 = gradient(base + s0)
    s1 = rho1 * unit(g1 - g0 - dual - global_perturbation)
    g2 = gradient(base + s1)
    s2 = rho1 * unit(g2)
    g3 = gradient(base + s1 + s2)
    positive = alpha * g1 + (1 - alpha) * g3
    negative = beta * g0 + (1 - beta) * g2
    corrected = g3 + beta * (positive - gamma * negative)
    total = s0 + s1
    next_dual = dual + total - global_perturbation
    torch.nn.utils.vector_to_parameters(base, model.parameters())
    return corrected, total, next_dual


def train(previous, data, client_id, epochs, batch_size, learning_rate, phi,
          rho0, rho1, alpha, beta, gamma, seed):
    if client_id not in previous["clients"]:
        raise ValueError("client is not registered in this GFed-HSAM run")
    values = (learning_rate, phi, rho0, rho1, alpha, beta, gamma)
    if (epochs < 1 or batch_size < 1 or not all(math.isfinite(v) for v in values)
            or learning_rate <= 0 or min(phi, rho0, rho1, gamma) < 0
            or not 0 <= alpha <= 1 or not 0 <= beta <= 1):
        raise ValueError("invalid GFed-HSAM training parameters")
    model = checked_model(previous).train()
    anchor = flat(model)
    drift = previous["clientDrift"][client_id]
    dual = previous["perturbationDual"][client_id].clone()
    global_s = previous["globalPerturbation"]
    loader = DataLoader(TensorDataset(data["x"], data["y"]), batch_size=batch_size,
                        shuffle=True, generator=torch.Generator().manual_seed(seed + previous["round"]))
    for _ in range(epochs):
        for x, y in loader:
            gradient, disturbance, dual = hsam_gradient(
                model, x, y, global_s, dual, rho0, rho1, alpha, beta, gamma)
            parameters = flat(model)
            # Algorithm 1 line 10: dynamic regularizer and real local SGD.
            direction = gradient + phi * (parameters - anchor + drift)
            torch.nn.utils.vector_to_parameters(parameters - learning_rate * direction, model.parameters())
    delta = anchor - flat(model)
    return {"algorithm": "gfed-hsam", "dataset": previous["dataset"], "model": previous["model"],
            "round": previous["round"] + 1, "baseRound": previous["round"], "clientId": client_id,
            "samples": len(data["y"]), "state": model.state_dict(),
            "clientDrift": drift + delta, "perturbationDual": dual,
            "perturbationResidual": dual - disturbance}


def aggregate(previous, updates, rho0):
    if not math.isfinite(rho0) or rho0 < 0:
        raise ValueError("RHO_0 must be finite and non-negative")
    by_client = {update["clientId"]: update for update in updates}
    if len(by_client) != len(updates) or set(by_client) != set(previous["clients"]):
        raise ValueError("every configured client must return exactly one result")
    model = checked_model(previous)
    anchor = flat(model)
    vectors, residuals = [], []
    drift, dual = {}, {}
    for client in previous["clients"]:
        update = by_client[client]
        if ((update["algorithm"], update["dataset"], update["model"], update["baseRound"], update["round"])
                != ("gfed-hsam", previous["dataset"], previous["model"], previous["round"], previous["round"] + 1)):
            raise ValueError("client model does not match the current round")
        if update["samples"] <= 0:
            raise ValueError("client has no training samples")
        vectors.append(flat(checked_model(update)))
        drift[client] = update["clientDrift"].clone()
        dual[client] = update["perturbationDual"].clone()
        residuals.append(update["perturbationResidual"])
    mean = torch.stack(vectors).mean(0)
    # Algorithm 1 lines 15-17: all configured clients participate, N == |S|.
    global_drift = previous["globalDrift"] + anchor - mean
    global_s = rho0 * unit(torch.stack(residuals).mean(0))
    torch.nn.utils.vector_to_parameters(mean - global_drift, model.parameters())
    return {**previous, "round": previous["round"] + 1, "state": model.state_dict(),
            "clientDrift": drift, "perturbationDual": dual,
            "globalDrift": global_drift, "globalPerturbation": global_s}

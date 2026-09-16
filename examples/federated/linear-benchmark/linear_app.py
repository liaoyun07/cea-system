"""FLPAR-21 isolated Application entrypoint; original SGD, SDK and CLI remain owners."""
import os
import sys

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
import model
import app

original_build = model.build_model
original_shapes = model.model_state_shapes


def build_model(dataset, name):
    if name != 'linear':
        return original_build(dataset, name)
    channels, size, classes = model.DATASETS[dataset]
    return nn.Sequential(nn.Flatten(), nn.Linear(channels * size * size, classes))


def model_shapes(dataset, name):
    if name != 'linear':
        return original_shapes(dataset, name)
    channels, size, classes = model.DATASETS[dataset]
    return {'1.weight': (classes, channels * size * size), '1.bias': (classes,)}


def mapped_load(path):
    # Page faults and the full epoch still occur inside the original Measurement.
    return torch.load(os.fspath(path), map_location='cpu', weights_only=True, mmap=True)


class BatchDataset(TensorDataset):
    def __getitems__(self, indices):
        index = torch.tensor(indices, dtype=torch.long)
        return tuple(torch.index_select(tensor, 0, index) for tensor in self.tensors)


def batched(value):
    return value


def batch_loader(dataset, *args, **kwargs):
    if not isinstance(dataset, TensorDataset):
        raise TypeError('This isolated candidate requires TensorDataset')
    return DataLoader(BatchDataset(*dataset.tensors), *args, collate_fn=batched, **kwargs)


def install():
    model.build_model = app.build_model = build_model
    model.model_state_shapes = model_shapes
    model.DataLoader = batch_loader
    app.load = mapped_load


if __name__ == '__main__':
    install()
    if len(sys.argv) > 1 and sys.argv[1] == 'train':
        os.environ['DATASET_PATH'] = '/cea-work/in/prepared_data'
    app.main()

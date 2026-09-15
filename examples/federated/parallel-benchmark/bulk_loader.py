"""FLPAR-04 isolated candidate: same DataLoader sampler, vectorized training fetch."""
import torch
from torch.utils.data import DataLoader, TensorDataset


class BulkTensorDataset(TensorDataset):
    def __getitems__(self, indices):
        index = torch.tensor(indices, dtype=torch.long)
        return tuple(torch.index_select(tensor, 0, index) for tensor in self.tensors)


def already_batched(value):
    return value


def bulk_training_loader(dataset, *args, **kwargs):
    # The production train function requests shuffle=True. Evaluation stays unchanged.
    if kwargs.get('shuffle') is not True:
        return DataLoader(dataset, *args, **kwargs)
    if not isinstance(dataset, TensorDataset):
        raise TypeError('This experiment only covers in-memory TensorDataset training')
    return DataLoader(BulkTensorDataset(*dataset.tensors), *args,
                      collate_fn=already_batched, **kwargs)

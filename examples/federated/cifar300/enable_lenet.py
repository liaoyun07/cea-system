"""Build-time model dispatch extension on the immutable deployed FedCADS core."""
from pathlib import Path
file=Path('/app/fedcads.py')
source=file.read_text()
for old,new in (
    ('model = DistillationModel(payload["dataset"], payload["model"])',
     'model = distillation_model(payload["dataset"], payload["model"])'),
    ('model = DistillationModel(dataset, name)', 'model = distillation_model(dataset, name)')):
    assert source.count(old)==1, 'Unexpected base image model dispatch'
    source=source.replace(old,new)
source+='''

def distillation_model(dataset, name):
    if dataset == "cifar10" and name == "lenet":
        from lenet import FusionLeNet
        return FusionLeNet()
    return DistillationModel(dataset, name)
'''
file.write_text(source)

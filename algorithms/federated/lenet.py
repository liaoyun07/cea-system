"""CIFAR-10 LeNet and fusion forward paths matching FedCADS author's model."""
import torch
from torch import nn
from torch.nn import functional as F

class LeNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1=nn.Conv2d(3,64,5)
        self.conv2=nn.Conv2d(64,64,5)
        self.pool=nn.MaxPool2d(2,2)
        self.fc1=nn.Linear(64*5*5,384)
        self.fc2=nn.Linear(384,192)
        self.fc3=nn.Linear(192,10)

    def features(self,x):
        x1=self.pool(F.relu(self.conv1(x)))
        x2=self.pool(F.relu(self.conv2(x1)))
        return x1,x2

    def classify(self,x2):
        x=F.relu(self.fc1(x2.flatten(1)))
        return self.fc3(F.relu(self.fc2(x)))

    def forward(self,x):
        return self.classify(self.features(x)[1])

class FusionLeNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.base=LeNet()
        self.fuse_conv=nn.Sequential(nn.Conv2d(128,192,1),nn.AdaptiveAvgPool2d(1),nn.Flatten())

    def forward_distillation(self,x):
        x1,x2=self.base.features(x)
        fused=torch.cat([F.interpolate(x1,size=x2.shape[2:],mode='bilinear',align_corners=False),x2],dim=1)
        return self.base.fc3(self.fuse_conv(fused)),self.base.classify(x2)

    def forward(self,x):
        return self.forward_distillation(x)[1]

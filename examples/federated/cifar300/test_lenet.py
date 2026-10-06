import unittest
import torch
from torch.nn import functional as F
import model
import fedcads
from lenet import LeNet,FusionLeNet
torch.set_num_threads(1)

class LeNetTest(unittest.TestCase):
    def test_reference_forward_and_initialization(self):
        torch.manual_seed(31)
        base=LeNet()
        torch.manual_seed(31)
        fused=FusionLeNet()
        self.assertTrue(all(torch.equal(v,fused.base.state_dict()[k]) for k,v in base.state_dict().items()))
        x=torch.randn(4,3,32,32)
        x1=base.pool(F.relu(base.conv1(x)))
        x2=base.pool(F.relu(base.conv2(x1)))
        expected=base.fc3(F.relu(base.fc2(F.relu(base.fc1(x2.reshape(-1,1600))))))
        auxiliary,prediction=fused.forward_distillation(x)
        self.assertTrue(torch.equal(expected,prediction))
        reference=base.fc3(fused.fuse_conv(torch.cat([F.interpolate(x1,size=x2.shape[2:],mode='bilinear'),x2],1)))
        self.assertTrue(torch.equal(reference,auxiliary))
        self.assertEqual(model.model_state_shapes('cifar10','lenet'),{k:tuple(v.shape) for k,v in base.state_dict().items()})

    def test_five_epoch_train_and_aggregation(self):
        clients=[{'id':f'edge-{c}','weight':w} for c,w in zip('abc',(2500,10000,37500))]
        previous=fedcads.initialize('cifar10','lenet',clients,31,300)
        data={'dataset':'cifar10','x':torch.randn(8,3,32,32),'y':torch.arange(8)%10}
        updates=[fedcads.train(previous,data,c['id'],5,4,.1,.001,31) for c in clients]
        result=fedcads.aggregate(previous,updates,.1)
        self.assertEqual(result['round'],1)
        self.assertEqual(result['totalRounds'],300)
        self.assertTrue(all(torch.isfinite(v).all() for v in result['state'].values()))
        network=model.build_model('cifar10','lenet')
        model.train(network,data,5,4,.1,0,31)
        payload={'algorithm':'fedavg','dataset':'cifar10','model':'lenet','round':1,'baseRound':0,
                 'clientId':'a','samples':8,'state':network.state_dict()}
        merged=model.aggregate([payload])
        self.assertEqual(model.evaluate(model.checked_model(merged),data,4)['samples'],8)

if __name__=='__main__':unittest.main()

# CIFAR-10 两种非IID划分与90%耗时实验

FL-CIFAR-90：完整50000训练/官方10000测试。等量16667/16667/16666（权重使用真实数量）；强非IID2500/10000/37500，均标签稳定排序、全部原样本恰好一次、像素标签不变。不是IID，也不改测试集。原v1与MNIST流程保持。

仅新增数据版本、引用识别镜像、八角色cifar-part-v1和四独立Flow；不改通用引擎、Java/API/表、SDK、权限或资源配置。原CNN为16/32通道双卷积、64隐藏层，SGD无动量；40轮、epoch1、batch128、lr0.1、seed31，CADS alpha0.001/rho0.1及schedule40。两算法主初权重一致，CADS另外包含辅助头/历史/教师。本批先测试已有模型，不保证90%，不暗改模型或训练配置。

计时口径：Flow启动→首次达到90%的评估任务结束；完整40轮仍执行，不早停。双方均达到才能计算 `(Avg时间/CADS时间-1)*100%`，未达标报告不能计算。按等量Avg/CADS、强Avg/CADS顺序执行，单种子、无独立预热，不能宣称稳定提升。

```powershell
docker build -f examples/federated/cifar10-partitions/Dockerfile -t cea/federated:cifar-part-v1 .
node --test examples/federated/cifar10-partitions/flows.test.mjs
./examples/federated/cifar10-partitions/register.ps1
# 数据先准备、上传/读回验证；镜像先发布到中心仓库，再使用真实digest。
node examples/federated/mnist-partitions/run.mjs register <immutable-registry-image> --cifar10
node examples/federated/mnist-partitions/run.mjs run --cifar10 --equal
node examples/federated/mnist-partitions/run.mjs run --cifar10
```

原始文件仅.local/cea/cifar10-partitions，读回在同级cifar10-partitions-readback，执行证据flow-equal/strong。输入注册只创建新对象，已有执行ID不重复提交。[验证](../../../docs/verification/VER-FL-CIFAR-90.md)。

四组均结束后，strong运行器自动调用finish.mjs，先执行两组独立audit，再生成.local/cea/cifar10-partitions/comparison.json及comparison.md。任何训练或audit失败均不生成通过报告；自动汇总尚未完成时不能称804Job核验已通过。核验在全部计时流程之后，不干扰其中一组的计时。

# FLPAR-21：轻量联邦组合验证

隔离实验：A=原MLP128；B=线性分类器3072→10、mmap、整批取样和评估batch1024。B仍执行完整FedAvg训练、聚合和10000条测试集评估，但模型变化，不称为原MLP等价加速。使用CEA已部署的六客户端均分raw v2预处理Flow；原业务Flow/镜像修订/SDK/服务容量均保留。

`linear_app.py`只为本次应用实验装配原数值核心的模型构建、权重形状、加载和DataLoader实现，原CLI、SGD、SDK、Runner与文件助手不变。mmap实际图像访问/训练/写出全部位于原SDK完整区间内，不用加载函数耗时代替算法耗时。

固定：6客户端，各边缘2个；每客户端完整读对应16667/16667/16666分片，累计10万、唯一5万；epoch1、联邦1轮、batch1024、seed13、lr0.01、每进程1线程。新模型更小，输入输出字节按每次真实报告，不沿用MLP总字节。

## 执行

依赖现有FLPAR-19观察器、公共测速区间计算、CEA私有配置（不输出凭据）以及`.local/cea/par13`独立参考/分片。证据写入新目录`.local/cea/par21`，拒绝覆盖。

1. 构建：`docker build -t cea/federated-linear:par21-v1 examples/federated/linear-benchmark`。基于已有不可变内容的par16镜像；构建结果需记录实际digest。
2. 成品镜像挂载本目录，执行`python -m unittest discover -s /candidate -p test_linear.py -v`；`PYTHONPATH=/app:/candidate`。
3. `node --test examples/federated/linear-benchmark/run.test.mjs`。
4. `docker save --output .local/cea/par21/linear.tar cea/federated-linear:par21-v1`。
5. `node examples/federated/linear-benchmark/run.mjs register`：上传已有API，四个应用新版本，两份新Flow。
6. `node examples/federated/linear-benchmark/run.mjs run`：各预热一次，正式AB/BA/AB，八次上限。失败保留并停下；读取实际日志/健康后`review-failure`，只续跑剩余计划，不替换失败。
7. 所有计时结束后执行`run.mjs audit`、`./examples/federated/linear-benchmark/audit.ps1`、`run.mjs verify`。

独立数值复核使用par07原SGD、原DataLoader、普通完整加载与原归一化在三个真实分片重训线性模型，核对成功执行的全部客户端/聚合模型及完整评估。计时期间不下载/重算模型。只报告成功子集不等于全批稳定性通过；2GB/s以实际完整流程结果判断，不将组件速度替代完整指标。

[验收与实际结果](../../../docs/verification/VER-FLPAR-21-linear.md)。

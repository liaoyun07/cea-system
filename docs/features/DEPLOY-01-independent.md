# DEPLOY-01 独立D盘部署

关联 OPS-001、FL-001、WF-016；状态见[功能索引](../02-feature-index.md)。

## 范围

新Docker Compose项目cea，专用MySQL/MinIO、四个认证Registry、四个独立K3s及前后端；数据与配置在D盘。只有FedAvg/FedProx首次登记及真实运行，不导入旧业务数据、不切换旧服务。

## 实现

[部署目录](../../deploy/cea/README.md)的Dockerfile、Compose、配置及PowerShell安装/初始化/验证脚本消费原S4/S5/UI-01能力。主链继续是Flow API→Executor→Worker→原ApplicationRunner→Resource/Distribution→KubernetesJobRunner。未新增Java类、DB表/列/迁移、API或SPI。

现有 `KubernetesJobRunner.upload` 改用Fabric8的InputStream上传，只传文件内容，不在tar中携带Worker宿主文件的UID/GID。真实消费者是非root后端向drop ALL capabilities的Pod传入模型/数据；否则tar恢复归属失败，无法启动训练。保持Pod权限限制及同一Runner/Execution主链。

`algorithms/federated/verify_run.py`将测试样本数断言从固定256改为实际测试文件长度，使同一数值审计支持全量MNIST；训练/聚合/评估算法未修改。

## 验收

1. Compose分组、网络、持久卷、显式配置；凭据不入Git/镜像。
2. 空库V1–V17迁移；API鉴权、Registry鉴权、非root后端和命名空间RBAC。
3. 新镜像中央上传→各边缘真实分发→对应四集群实际Job。
4. 两算法各2轮/11个Job，真实60000训练与10000测试数据，逐模型数值复核。
5. 前端读取真实Flow与成功执行/输出，日志页与API一致；重启后定义、执行和产物保留。Application不生成core.Log记录、Pod stdout未汇入该页，不宣称算法日志采集完成。
6. 完整Maven回归、相关Python/Node和部署脚本检查。

## 边界

单主机多集群，不是物理多云。中央对象存储、不含Pod服务DNS/Ingress/PVC、无物理终端或网关代理。DQN研究、速率、Pod stdout汇入Execution日志、旧迁移/切换和已后置生产保障保持未实现。

[验证记录](../verification/VER-DEPLOY-001-cea.md)记录实测结果，不以文档代替执行。

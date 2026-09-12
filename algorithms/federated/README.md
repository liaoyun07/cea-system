# FedAvg / FedProx应用

仅本地文件输入输出；没有MinIO客户端、平台SDK、旧FLOW_*环境变量或隐藏模板注册。运行语义见[S5-02规格](../../docs/features/S5-02-federated.md)。

两个Flow示例在inputs中显式声明training_dataset/test_dataset为SELECT，当前选项为mnist-train/v1和mnist-test/v1，启动页直接下拉选择。新增可用数据集时，由Flow作者调整values并确保Application DatasetRule与实际Location满足要求；平台不自动派生Flow Input或合并契约选项。

## 文件职责

- model.py：MLP/CNN、SGD/FedProx、样本数加权聚合和评估。
- app.py：init/train/aggregate/evaluate CLI，读写平台准备的本地文件。
- seed.py：在任务外下载真实MNIST并生成不重叠训练分片和独立测试文件。
- test_federated.py：7项数值/错误输入/数据完整性测试（单元样本是明确的随机张量）。
- verify_run.py：重算集成测试导出的真实MNIST训练模型、聚合与评估。
- Dockerfile：Python3.11.15、Torch2.2.2+cpu、NumPy1.26.4；不包含数据集。沿用旧算法依赖主版本便于核对数值，不宣称这是最新或已做安全审计的依赖栈。

## 准备数据与镜像

在backend根目录执行：

```powershell
docker build -t cea-federated:s5-loop-v1 algorithms/federated
docker run --rm cea-federated:s5-loop-v1 python -m unittest -v test_federated
New-Item -ItemType Directory -Force .local/mnist
$taskData = (Resolve-Path .local/mnist).Path
docker run --rm --mount "type=bind,source=$taskData,target=/data" cea-federated:s5-loop-v1 python /app/seed.py --output /data
```

默认生成真实MNIST训练60000条（按标签排序后1:2:3分为10000/20000/30000）和独立测试10000条。显式传--train-samples 768 --test-samples 256可复现集成验收规模；不代表完整数据集精度测试。下载失败即失败，不回退合成数据。manifest.json记录来源和样本数，数据只写.local且不提交Git。

下载文件及已有raw文件均按[torchvision官方MNIST资源校验值](https://github.com/pytorch/vision/blob/v0.17.2/torchvision/datasets/mnist.py)检查完整性，不通过则拒绝生成分片。这仅是数据下载完整性校验，不是领域对象hash。集成测试在target/federated-data/raw复用已校验原始文件，缺失时仍需下载；不缓存执行结果或跳过实际训练。

把edge-a.pt、edge-b.pt、edge-c.pt、test.pt分别上传到你配置的对象存储datasets桶下mnist/v1/同名文件；使用管理员现有存储工具，不把密钥写进Flow。文件位置和版本须与[数据目录](../../examples/federated/datasets.json)一致。切换真实站点存储位置时编辑目录数据，不能谎报数据已落地。

按你的Registry地址另行tag/push该新镜像；不要覆盖旧gateway镜像标签。本批测试只推送隔离Registry，不替你发布到已有Harbor。后端的Registry/Kubernetes/S3配置沿用[S4部署](../../docs/contracts/s4-job-execution.md)，需要cloud、edge-a/b/c四个连接和对应资源目录项，且有足够平台Job槽。无需修改Java。

## 首次注册与执行

先配置BACKEND_USER、BACKEND_PASSWORD及新后端专用资源；注册脚本只写你指定的新后端API：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-federated.ps1 -Image '你的仓库/lab/cea-federated:s5-loop-v1'
```

脚本读取JSON契约和YAML，依次登记两个数据集版本、五个应用版本、两个Flow首版，不触碰已有集群配置、不自动执行任务。已存在的Flow会因expectedRevision=0拒绝覆盖；编辑使用既有revision API，不通过脚本强制重置。应用/数据集已有版本按后端不可变版本语义处理，修改内容须使用新版本并同步Flow。

通过既有Execution提交API执行flowId=fedavg或fedprox，默认两轮；输入可覆盖rounds、model、training_dataset、test_dataset、local_epochs、batch_size、learning_rate，FedProx另有prox_mu。客户端集合在Loop.values中编辑并保存新修订，不再提供clients启动参数。契约仅允许mnist-train/v1、mnist-test/v1，不能输入任意名称绕过。

每轮evaluate的TaskRun outputs.metrics.json是该轮全局损失/准确率产物，最终Flow输出global_model和completed_rounds。执行历史保留全部轮次，没有新增图表、指标数据库或吞吐计算。

已有S5-02注册数据不会自动改变：本批aggregate CLI改为清单协议，需将新构建镜像登记为新的ApplicationVersion（例如v2），同步编辑Flow中的版本和Loop定义并保存新修订，再提交新Execution。首次注册示例在空目录仍用v1；不得覆盖已有版本或只更新Flow却继续用旧聚合镜像。

## 文件契约

输入模型：/cea-work/in/global_model；客户端数据：DATASET_PATH；测试数据：TEST_DATASET_PATH。后两者由系统按照DatasetRule和选中集群注入，是本地pt文件，不是对象存储URL。

输出默认/cea-work/out/model.pt；evaluate显式--output /cea-work/out/metrics.json。aggregate通过--clients-manifest /cea-work/in/client_models.json读取平台准备的有序本地路径数组，禁止扫描产物目录。state_dict文件只使用weights_only=True读取；应仅登记受信任的数据和镜像。

客户端由clients任务的loop.values显式给出，使用LITERAL.value数组，默认三项，如`[{"id":"edge-a","clusters":["edge-a"]},{"id":"edge-c","clusters":["edge-c"]}]`。可在Loop的Array表单中逐项编辑。Loop内只有一份train，增加客户端不再增加Task和aggregate argv。并发上限由Flow的loop.concurrency控制（示例6），实际还受Worker和平台Job槽约束。每项CLIENT_ID必须唯一；算法拒绝重复客户端，不由Loop去重。集合不得为空用于联邦聚合；通用Loop本身允许空集合。没有自动客户端发现/抽样或无限循环。

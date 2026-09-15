# FLDATA-01 CIFAR接入验证

日期：2026-09-15。状态：DONE/PASS，已发布当前CEA。源码基线：`31b8f816ed320a6a37df292a26ee54a565114545`及本记录同批提交的差异。

范围：MNIST回归，CIFAR-10/CIFAR-100完整数据、两种联邦算法和相同执行链；[协议](../contracts/federated-datasets.md)。不是算法精度、跨物理站点或2GB/s性能验收。

## 环境与自动化结果

Windows / Docker Desktop，16个可用CPU、约15.39GiB内存；独立CEA四个K3s与四个存储，平台入口18080/API18085。Java21、Node24.19.0；算法Python3.11.15、Torch2.2.2+cpu、NumPy1.26.4。Java和前端生产源码本批无变化。

| 验证 | 实际结果 | 本地证据 |
|---|---|---|
| 完整`scripts/verify.ps1` | 262 PASS；14:02:33完成，16分03秒，含真实MySQL/Registry/K3s、MNIST两算法数值验收和打包JAR启动 | `.local/cf01-verify.log` |
| 新算法镜像Python | 11 PASS；涵盖10/100类MLP/CNN、两算法、标签/形状、配套版本和损坏数据 | `.local/cf01-python-tests.log` |
| 升级保留单测 | 3 PASS；从MNIST旧定义升级、移除旧init参数、保留其它参数/Loop/输出/轮数、重复变换稳定 | `scripts/upgrade-federated-datasets.test.mjs` |
| 前端单测 | 53 PASS | `.local/cf01-frontend-unit.log` |
| 浏览器回归 | 60 PASS，3.8分钟；两Flow启动对话框选择CIFAR10/100，包含编辑/管理回归 | `.local/cf01-e2e.log` |
| 当前18080只读浏览器 | FedAvg r8和FedProx r6的启动对话框均显示三个配套train/test选项；默认MNIST；关闭对话框，未提交额外任务 | 本任务浏览器操作记录 |
| 数据与保留检查 | 全量数据独立审计、八对象长度、旧Flow/契约/数据集/策略和19个服务身份核对通过 | `.local/cf01-data-audit.log`、`.local/cea/cf01/` |
| 结构与格式 | scaffold PASS（8模块、109个Java文件、32个功能编号、753个本地链接）；git diff --check及两份PowerShell解析PASS | 本任务最终验证输出 |

浏览器自动化回归使用隔离测试环境；真实CEA另有上述人工操作式浏览器与API核验，两者不混为一次测试。前端生产源码无变化，因此无需重建前端。首次前端单测仍期望“只有MNIST”而失败，更新数据选项断言后53项全部通过。

## 完整数据与实物

来源为[CIFAR作者发布页](https://www.cs.toronto.edu/~kriz/cifar.html)的binary归档，而非合成图片或pickle。实际下载并验证：

| 数据集 | 原始归档字节 | 官方MD5 | 训练/测试条数 |
|---|---|---|---|
| CIFAR-10 | 170052171 | `c32a1d4ab5d03f1284b67883e8d87530` | 50000 / 10000 |
| CIFAR-100 | 168513733 | `03b5dce01913d631647c71ecec9e9cb8` | 50000 / 10000 |

独立审计不是只查manifest：重新从归档读取记录，比对所有分片/测试文件的标签和归一化像素、RGB顺序、float32/long类型、原始索引；训练索引并集恰为0..49999，无重叠，不混入测试。CIFAR-100使用fine标签0..99，不是20类coarse标签。

两系列分别有edge-a/b/c的8333/16667/25000条训练分片和10000条测试。两个系列每份对应文件的长度相同：102864141 / 205339021 / 307801549 / 123041535字节。准备容器限制2GiB完成。八份新文件先上传中心MinIO的`datasets/{cifar10,cifar100}/v1/`，逐一`mc stat`比对后才登记四条DatasetVersion/八条Location。旧MNIST文件和目录记录不覆盖。

Location是逻辑客户端可用分片；本批数据实物仍在中心MinIO，不宣称已复制到边缘。训练产物继续实际写边缘存储；跨集群文件仍用既有公共助手。

## 发布及真实执行

发布新镜像`cea/federated:cf01-v1`，实际应用引用：

```text
registry-center:5000/lab/federated@sha256:481cfc4fc3bf01ee8806778f1214bcdb735fe87e279e575bdb3ec890dfdb7794
```

14:05登记五个角色的`cf01-v1`不可变ApplicationVersion，并保存FedAvg r8、FedProx r6。升级脚本捕获原修订后使用expectedRevision提交；只更新支持的数据选择、init显式版本参数和应用版本，保留用户其余配置/历史，不启动第二执行链。init的两个版本参数没有DatasetRule，不下载原始数据。

以下均为当前CEA新镜像的真实执行，统一两轮、MLP、每客户端每轮1个epoch、batch32、learning_rate0.01，FedProx mu0.1。CIFAR完整50000训练/10000测试；MNIST完整60000/10000。

| 算法/数据 | Execution ID | 第二轮测试accuracy | 执行与独立数值审计 |
|---|---|---|---|
| FedAvg / CIFAR-10 | `5245a965-ea27-40f3-aceb-045ac138f215` | 0.3426 | SUCCESS / PASS |
| FedProx / CIFAR-10 | `5cfe9216-e509-4bcd-bc4b-efe7879510ac` | 0.3386 | SUCCESS / PASS |
| FedAvg / CIFAR-100 | `3d0cfbb6-c179-4820-9a1b-38b6e4e1b0c7` | 0.1015 | SUCCESS / PASS |
| FedProx / CIFAR-100 | `a12705e5-64ca-4391-ac2c-e7e286c14398` | 0.0935 | SUCCESS / PASS |
| FedAvg / MNIST回归 | `b55a2324-514d-4ef4-9e12-5b2367253124` | 0.6229 | SUCCESS / PASS |

每次核对11个成功Job（init＋两轮各3train/aggregate/evaluate）、真实四集群位置、Pod的files-in/files-out助手、算法无存储凭据、输出桶与执行位置一致、最终完成轮数2。导出模型并以同一原始数据独立重算每个客户端更新、按样本数加权聚合、评估结果；不是仅看Execution SUCCESS。上述accuracy仅记录这组两轮非IID基线结果，不代表收敛精度目标，也不是CIFAR研究性能比较。

复测命令（会创建新的Execution；已有ID可用`-ExecutionId`仅核验）：

```powershell
./deploy/cea/verify-federated.ps1 -Algorithm fedavg -Dataset cifar10 -Image cea/federated:cf01-v1
./deploy/cea/verify-federated.ps1 -Algorithm fedprox -Dataset cifar100 -Image cea/federated:cf01-v1
```

脚本默认镜像仍为首次安装脚本构建的`cea/federated:deploy-v1`；当前增量镜像必须如上显式指定，避免将旧镜像用于数值审计。

## 失败、修复和保留边界

首次FedAvg/CIFAR-10执行`edbcf149-d0ea-4510-b63e-f46ffd838407`失败。init已经成功生成model.pt（1580480字节）和报告（185字节），但files-out在传输阶段超时，尚未开始训练。现场核对证明Docker重启后MinIO容器IP变化，而Pod使用的`transfer-endpoint`仍指向旧地址；不是数据格式或训练报错。

备份原私有配置到`.local/cea/cf01/storage-endpoints-before.yaml`后，根据四个CEA MinIO容器实际地址刷新现有`deploy/cea/secrets/backend/storage-endpoints.yaml`中的四个`transfer-endpoint`：center `.4→.2`、edge-a `.15→.4`、edge-b `.14→.15`、edge-c `.12→.17`（共同前缀172.26.0，端口9000）。只重启backend加载配置，`/health`恢复UP；同一新镜像后续五次执行通过。没有重启数据库、MinIO、Registry、集群或前端；失败记录与证据保留，未删除或改写。

`--verify`核对19个常驻服务的容器ID/名称/镜像不变，不等于其启动时间均未变：backend为上述修复发生过一次重启。旧Flow修订、旧应用版本、旧Dataset定义和全部边缘策略逐项保持。原历史执行未修改；新测试执行单独追加。后续Docker整组重启仍需核对Pod传输地址；本次不是持久DNS/网络方案重构。终端代理的相关地址白名单未在本批调整，已另行询问是否一起修复，未收到确认前不扩大到终端服务。

## 改动与未实现

新增两个数据集的真实准备、100类模型、明确的init配套版本校验，以及有消费者的升级脚本；沿原DatasetRule/Placement/文件助手/Worker和计量SDK。无新增/删除生产Java、表、列、API、SPI或状态机。本批不改变Kestra参考的通用流程语义；只使用项目已有的显式Flow/参数模型。

训练仍一次载入单客户端分片，MLP/CNN只在单元测试均覆盖，现场五次统一MLP；不宣称已测CNN的完整CEA训练。未增加数据增强、流式加载、自动客户端采样，也未改变或优化数据处理速率定义。

本地证据：`.local/cf01-*`、`.local/cea/cf01/`、`.local/cea/evidence/<algorithm>/<executionId>/`。数据/凭据/构建产物不入Git。

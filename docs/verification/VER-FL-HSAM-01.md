# VER-FL-HSAM-01

日期：2026-10-07。源码基线：d0a2907989f793641c29fcfd0f128c345b1c61fb，已有未提交/暂存修改保留，不纳入本批。

## 已完成的本地验证

Docker Desktop Linux / Python3.11 / PyTorch2.2.2 CPU，现有cifar300-v1派生新gfed-hsam-v1镜像；不重新安装依赖。

- `python -m unittest -v test_gfed_hsam test_federated test_fedcads`：24项PASS，0失败。新增7项覆盖独立四梯度公式、参数恢复、半径/状态真实影响、SGD极限、两轮序列化/动态聚合、混轮/缺失/重复拒绝、四类模型与CLI文件链；原17项回归PASS。
- `node --test examples/federated/gfed-hsam/definitions.test.mjs`：3项PASS，四契约与Flow所有参数完全对应、Repeat/Loop反馈与全客户端参与、数据集选择/准备保持；API数据集允许集合排序不影响语义，缺失成员仍拒绝。
- 不包含原文缺失投影的作者实现验证；约定见[协议](../contracts/gfed-hsam.md)。未开展精度/收敛/速度比较，不宣称优于FedAvg。

## CEA真实发布与验收：PASS

- 新共享CPU镜像 `cea/federated:gfed-hsam-v1`，Registry digest `sha256:af333cdd63056cf08531fd74519e95be2633b2e23458e642e07247778ace0fd8`；只登记四个新v1应用与 `gfed-hsam` r1，旧镜像和版本不覆盖。
- 真实执行 `63f26c68-56c5-4a68-93ca-afa09002b760`：SUCCESS，UTC 2026-10-06 18:34:01→18:34:54（本地10月7日）。强非IID全60000训练样本（3000/12000/45000），固定3客户端、完整epoch1/batch128/lr0.1/seed31，模型MLP、两轮；不是缩小数据的模拟。
- 11个真实Job均一次成功；六训练、两聚合、两评估、一初始化。9个model.pt独立下载、元数据与初始化权重核验；每轮三个客户端漂移、云端模型/漂移/全局扰动公式和跨轮状态逐值通过。edge-a两个实际轮次另用独立四梯度/显式参数复制程序重训复算，不调用生产train/aggregate，结果一致。
- 两轮官方10000测试样本独立复算与线上metrics一致：第一轮accuracy 34.97%、loss 2.333815816116333；第二轮89.23%、loss 0.339096457195282。只做功能验收，未验证95%或时间提升。
- 发布前后74个旧Flow定义、120个旧应用版本、20个数据集版本逐项一致，20个原服务ID/镜像/启动时间一致；没有Java、前端、权限、数据库、资源配置变化或服务重启。
- 后端18085/health及前端18080均HTTP200；Flow经真实API校验、保存及回读，四契约回读与预期语义一致，门户现有列表可直接使用。
- `scripts/check-scaffold.ps1` PASS：8模块、109生产Java索引、32功能ID，本地文档链接检查通过。仅Python算法/新示例变化，不需构建或部署Java/前端；未重跑完整Maven，不以历史结果冒充本次通过。

## 验证中修正与边界

首次注册在两个应用已写入后，观察器将后端排序后的DatasetRule.allowed集合与原数组顺序作严格比较，报错；修正集合规范化和完全相同定义的断点续接，补一项回归后完成注册，不覆盖旧版本。没有提交失败的训练执行。

产物审计先完成全部数值核验，随后Job入口检查误认为command是Python数组；实际平台包装为/bin/sh及args。修正只读观察器并处理无args的文件助手后完整审计通过，没有改算法/引擎、补跑或替换训练样本。

论文描述歧义均在[协议](../contracts/gfed-hsam.md)列明。本次不宣称作者精确复现、算法性能优势或物理多云实测。Git同步仅纳入本批文件及三份索引的FL-HSAM-01新增段落，既有暂存/未提交改动保持。

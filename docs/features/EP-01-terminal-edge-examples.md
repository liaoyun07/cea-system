# EP-01 终端真实上传与三个边缘策略

状态：DONE，2026-09-13已发布CEA并通过真实三策略验收。[验证记录](../verification/VER-EP-001-terminal-edge.md)。用户授权三个策略、终端容器真实上传、测试与CEA部署。

## 最小边界

终端文件 → HTTP网关 → edge-a对象存储 → data-ready事件 → 原EdgeAccessService → 原FlowExecutionService/Executor/Worker → Pod文件助手/算法。

网关使用独立CONNECT账号及仅本边缘的S3权限；终端只有自己的接入token。上传对象键由网关生成，包含终端ID和随机上传ID；上传完成后才能触发事件。禁止终端提供bucket、cluster、URI、任意Flow输入。网关向作者显式声明的`data_uri`传入对象地址，不派生Flow Input。利用S3原子PUT及已有事件幂等收据，不新增上传表、第二套任务状态或Java接口。

三个策略均从edge-a接入；这是示例资源绑定，不是“一类策略必须一个集群”。

| 策略 | 数据/算法 | 主要去向 |
|---|---|---|
| hydraulic-local | UCI液压台架，原采样率清洗及分窗统计 | 清洗数据及摘要留边缘 |
| bearing-return | CWRU振动，时域/频域特征和随机森林 | 小型诊断JSON经网关返回终端 |
| surface-cloud | MVTec AD tile，正常样本训练的PaDiM | 检测摘要传中心生成批次报告；原图/热图留边缘 |

上传和返回不在中心转发文件。返回仅允许原终端所属执行的`terminal_result`，且必须是该Execution在本网关边缘存储的限量JSON。后台执行状态仍只有原Execution。禁用网关/终端后拒绝新接入；未完成上传不会发事件。终端可以用同uploadId重试事件，不保证重新上传自动去重；离线上传队列和断点续传不做。

真实采集由公开数据回放代替；上传、存储、事件、容器计算和结果返回必须真实。不能把单机Docker隔离云当物理多云，不编造诊断精度或吞吐指标。数据和模型留在ignored目录，不上传GitHub。MVTec仅非商业研究使用。

## 验收

- 网关HTTP测试：无效身份、归属、路径/大小、短上传、未上传事件、跨终端结果、JSON上限。
- 算法测试：真实数据训练/测试隔离；数值独立复核；坏文件明确失败。
- 三次真实终端容器上传→原策略Execution成功，保存请求/结果证据并核对对象实际所在位置。
- 原FedAvg/FedProx修订、历史和旧部署不变，原回归及scaffold通过。
- 部署只改变新增网关/终端及后端CONNECT配置；无前端代码变化，不做无意义前端重建。

## 参考

- Kestra本地提交0354ddf8：`webserver/.../ExecutionController.java`通过`flowInputOutput.readExecutionInputs`解析作者输入后进入原执行链。本项目有意增加边缘域文件接入，仍用同一Flow事实源。
- [UCI液压数据](https://archive.ics.uci.edu/dataset/447/condition+monitoring+of+hydraulic+systems)，CC BY 4.0。
- [CWRU实验数据](https://engineering.case.edu/bearingdatacenter/download-data-file)，按源文件/负载划分，先划分再切窗。
- [MVTec AD](https://www.mvtec.com/research-teaching/datasets/mvtec-ad)，CC BY-NC-SA 4.0；正常训练/校准与测试分离。

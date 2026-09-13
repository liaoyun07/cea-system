# VER-EP-001 真实终端上传和三个边缘策略

2026-09-13，起点main `9bdc7af`，Windows/PowerShell7、JDK21、D盘Docker Desktop。实现及CEA发布完成。无Java类、表/列、平台API、DSL、Executor/Worker/Placement变化；新增网关HTTP接口、算法/回放程序和普通Flow。不是物理云边端、设备实时采集或吞吐验收。

## 自动化和算法验证

- 20:47:37完整`scripts/verify.ps1`：237项，35 runtime + 201 server + 1打包JAR；失败/错误/跳过均0，包含47项真实Registry/K3s/文件/FedAvg/FedProx相关测试。
- 最终网关/终端12项：真实HTTP单测、上传MD5/字节、短上传不发布、大小和并发限制、身份/停用/错误域、所属对象/结果、越权URI、结果大小、收据写入失败不发生网络副作用，PASS。
- 算法7项：原采样率窗口及明确标记的缺失值fixture、错误周期/文件、频谱峰值、Gaussian/Mahalanobis独立闭式对照、中心报告计算、归档限制，PASS。
- 四个算法命令用实际数据在`--network none`容器执行，PASS；运行任务不临时下载权重/数据。
- scaffold、PowerShell解析、Compose静态校验PASS。原前端没有代码改动，未把旧浏览器测试当本次重跑；实际18080代理API已验收。

训练来源与划分保存在ignored数据目录，原数据/权重未进Git：

| 算法 | 实际数据/划分 | 结果与限制 |
|---|---|---|
| 液压窗口 | UCI PS1/FS1/TS1，10个60秒周期，100/10/1Hz | 180个10秒窗口，原样本无缺失；清洗数据与原值逐项一致，均值独立复算 |
| 轴承RF | CWRU fan-end 12kHz，0/1/2HP训练1122窗口，3HP测试415窗口；先分源文件再切窗 | accuracy 0.886747；滚珠47窗口错判内圈，不能视为生产级可靠诊断；不自动操控设备 |
| 表面PaDiM | MVTec tile正常184训练/46校准，官方117测试 | AUROC 0.945887，校准阈值下accuracy 0.854701，仍有漏检；128px/32维CPU简化，不是论文精度复现 |

## CEA实际结果

| 策略/Execution | 原始上传字节 | 结果 |
|---|---:|---|
| hydraulic-local / `19eeef85-9331-4b2c-b2b2-2d540b513517` | 97,247 | SUCCESS；cleaned.npz、summary.json、metrics.json均在edge-a |
| bearing-return / `582c9f41-6603-4962-82f6-ee05514d0946` | 2,076,954 | SUCCESS；415窗口诊断JSON完整经网关返回终端，逐窗口与独立负载测试预测一致 |
| surface-cloud / `983fefb4-9d7e-4961-8409-fef8d450e4a8` | 5,969,364 | SUCCESS；6张图在edge-a推理、热图保留；605字节inspection.json供cloud报告读取，报告4/6疑似缺陷，与分数/阈值复算一致 |

共3 Execution、4 Job、10个输出（8边缘、2中心）。605字节是跨域算法输入摘要大小，不是系统总网络流量，不含镜像分发/协议/控制元数据。原始上传3对象均在edge-a，下载与终端文件逐字节相等，中心不存在对应原始对象或边缘TaskRun产物副本。模型已预置边缘，终端从未持有S3或平台人员凭据。

同uploadId/事件重试返回原executionId；同key改事件409，另一终端用该上传/执行404。没有产生重复Execution。结果中的文件位置逐个HEAD/GET核实；水压均值、预测列表、表面分数及中心报告独立复核PASS。

20:55:18通过实际18080 API与容器检查：原2个USER Flow及7条Execution全部View字段不变；其余15个原服务ID/镜像/StartedAt均不变。后端仅重建以载入CONNECT配置，Java镜像仍原版本；frontend只reload。没有旧系统切换、原数据迁移、DB migration或Registry/K3s重启。新增1个常驻edge-gateway；terminal-replay按次运行后自动删除容器，保留收据。

## 排错经过（未隐藏失败）

- 首次算法构建时prepare.py尚未创建，构建失败；补文件后成功。CWRU 99.mat包含98/99两组字段，准备器改为精确实验编号，避免误取另一实验。归档大小检查加入时发生局部名称冲突，两项测试报错，修正后全部重测通过。
- XZ随机访问造成重复解压，停止本批离线准备容器，改顺序读取到本地ZIP缓存；不改变样本划分或算法。最终模型与完整测试重新生成。
- 首次发布命令用了Compose run不支持的env-file，尚未变更服务即失败，改为在工具容器读取挂载凭据。之后发现可选`.json`配置未被Spring加载，网关登记被403拒绝；改为JSON内容的`.yaml`，机器认证与登记成功，移除本批无效旧扩展名文件。未新增Java兼容分支。
- 网关tmpfs的YAML逗号未加引号被拆为两个挂载项，启动拒绝；修正引号后健康。Compose静态校验不等同于Docker挂载验证，此故障已记录。
- 第一次液压执行已被平台接受，但非root终端不能写准备器root创建的证据目录。只对该新目录授予终端UID所有权；临时chown工具仅额外CHOWN能力，正常终端仍非root/只读根/无Linux能力。根据原Execution和原上传地址恢复该收据，不重新上传/执行；新增“先验证证据可写，再上传和发事件”测试。另两次收据由终端正常写出。

## 证据和限制

`.local/cea/edge-processing/`：verify.log、gateway-tests.log、两份算法evaluation.json、before.json、release.json；`evidence/`含3收据、live-check.json及实际下载的10产物。`verify_live.py`、`audit.py`、`verify-release.ps1`可重做验收，凭据与大数据只留本机。

内网HTTP/静态token，最大64MiB且两路上传；无断点续传、离线自治、自动存储GC、MQTT、硬件采集、执行器命令或计量SDK。无事件的上传不自动清理。MVTec仅非商业研究，CWRU再分发许可未确认，源数据不进公开仓库。

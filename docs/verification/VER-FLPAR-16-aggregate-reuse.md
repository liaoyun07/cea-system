# FLPAR-16：聚合元数据检查与镜像复用

2026-09-16，DONE并已部署。仅本批两项优化；不修改标签/索引检查、SDK时间/字节口径、训练数学逻辑、Worker/槽位和Job完成判定，不处理此前未知高并发失败。源码基线5b0e84a，已有未提交工作原样保留并排除在本批提交之外。

## 改动与边界

- 聚合删除输入N次＋结果1次的验证用完整模型创建/权重加载，改为权重名称/形状/一致dtype检查；保留业务轮次、样本权重和客户端身份检查。没有权重数值扫描，训练/评估仍加载实际模型。shape表覆盖当前两模型/三数据集，测试与真实模型state_dict核对；不增加通用模型注册器。
- ImageDistributionService使用既有RegistryHttpClient的HEAD：精确digest存在即复用；仅404调用原Skopeo copy，复制后再确认。tag实时解析，固定digest无需源端inspect。认证/HTTP异常/错误digest不按缺失处理，无成功缓存、无新表/SPI。命中不新增分发历史，真实复制与失败仍记录；删除后再次请求需重分发。接口/状态名称不变。
- 参考本地Kestra 0354ddf8cb的script/.../runner/docker/Docker.java:997：IF_NOT_PRESENT先inspect，仅NotFound拉取。相同点是核实存在后复用、不把所有错误当缺失；本项目处理中心/边缘Registry而非Docker本地image store，是云边场景差异。官方Distribution v2的Existing Manifests HEAD用于实际存在性查询：https://distribution.github.io/distribution/spec/api/#existing-manifests 。

## 自动化验证

- 18项Python单测PASS，含4项新增元数据检查测试（异常首个/后续客户端、名称、形状、防广播、dtype、无模型创建/无输入修改）。第一次只读测试容器未提供临时目录，5处临时文件用例报错；加独立/tmp tmpfs后18/18通过，未更改业务绕过测试。
- 在原par08镜像中独立载入新model.py，与镜像内原aggregate逐张量比较：两算法×三数据集×两模型×1/6/9/18客户端，48组/288张量完全相同。
- Java第一次构建发现构造参数registry与原局部变量重名，已更正；第二次完整scripts/verify.ps1（JDK21）273项通过：runtime35、measurement7、server230、打包启动1；0失败/错误/跳过，16分43秒。包含51项真实Registry/K3s集成测试及新增HEAD错误分流、固定digest命中时不可用Skopeo仍成功、删除后重分发；分页测试使用两次真实分发，不把复用记录成传输。受控迁移失败/数据库断连用例日志中的ERROR不等于测试失败，报告均通过。
- 提交索引单独构造，仅纳入本批aggregate及结构回归，不带入此前训练/归一化/扫描移除改动；索引版本15项Python测试另行通过，避免混合工作树通过而提交子集失败。
- check-scaffold与git diff --check通过；无新增生产Java、表/列、API、SPI或配置参数。新增测试类RegistryReuseTest、Python测试/对照脚本、专用聚合Dockerfile及本地发布脚本。
- 镜像构建成功：cea/federated-aggregate:par16-v1，在现有par08基础镜像上仅覆盖model.py，仅聚合入口消费新逻辑。通过现有上传API登记fl-aggregate/par16-v1，Registry实际digest为sha256:494516d2de97db45e6523f899002d66a96ad147ab03c1f39867854775cc642a7（归档导入后的manifest）。

## 发布范围与证据

已发布backend和fl-aggregate/par16-v1；后端image sha256:c3d5430d5c783ca9812e41c512907a6a72bc19470baddfc991d53e0f5cff0a99，旧镜像保留cea/backend:pre-flpar16。前端仅reload反向代理，无镜像修改/容器重建。真实/health为UP，18080 HTTP200；最初误查/actuator/health得到401/404，改用仓库已定义的/health后通过，未绕过健康检查。

只变六个Flow的聚合版本：fedavg r11、fedprox r9、par12-fedavg-cifar10-c3-preprocess r3、par15-fedavg-cifar10-c6-preprocess r2、par08-fedavg-cifar10-c9-preprocess r3、par10-fedavg-cifar10-c18-preprocess r3。保存前核对旧修订，保存后逐字段比较；其他配置不变。

四仓库实际验证：首次边缘复制edge-a/b/c分别4394.69/3946.37/5401.53ms，随后复用67.86/64.82/68.99ms；中心原本已有上传的manifest，两次都复用，第二次65.95ms。复用PreparedImage不变，历史无新增；只真实三次边缘复制产生分发记录。计时是整次本机API调用，非纯网络HEAD耗时，不作为吞吐或并发验收。

| 实际执行 | Execution ID | 验证 |
|---|---|---|
| FedAvg MNIST 2轮 | bbc8ec7b-8384-4652-918e-484f896de701 | SUCCESS，11 Job，四集群/存储/文件助手及两轮独立训练、聚合、评估数值复核PASS |
| FedProx MNIST 2轮 | acd06312-fe54-4d7b-9fef-f3c02291127a | SUCCESS，11 Job，同上独立数值复核PASS |
| CIFAR-10三客户端预处理＋训练 | 6dc33c26-3958-45dd-97fb-7144ec141696 | SUCCESS，9叶任务，单轮，计量AVAILABLE；本次未单独重训此CIFAR执行做数值审计 |

三个实际执行计量均AVAILABLE，未修改SDK；本次为功能回归，非预热后多轮性能比较，不据此推断速率提升比例。数值审计用原par08镜像，算法输出不是只检查状态就宣称正确。

最终核对PASS：原278条Execution逐字段不变，32个Flow只上述六个产生新修订、数据集/旧应用/容量配置不变；当前281条Execution、19个CEA服务，除backend外18服务ID/image/启动时间完全保持。不重启数据库、Registry、K3s，不删除任何原镜像/数据。证据在忽略目录.local/cea/par16及.local/cea/evidence/{fedavg,fedprox}/执行ID，凭据/归档/模型不提交。

当前不声称2GB/s、高并发稳定性或提速幅度通过；既有9/18客户端失败仍待独立定位。首次并发缺失时不做请求合并，不增加锁/缓存；HEAD确认仓库manifest存在并不代表节点本地已有镜像，节点拉取仍由Kubernetes原IfNotPresent策略处理。

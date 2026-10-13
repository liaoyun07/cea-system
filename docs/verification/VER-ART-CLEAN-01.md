# ART-CLEAN-01 预处理产物清理

日期：2026-10-14。基线源码：785e6256840c3accdf2e9cf5d3756e2888b2b4bd；本批提交见Git历史。验证和部署基于当前工作树，含此前已部署但尚未提交的TERM-DIFF改动；本批提交仅包含ART-CLEAN-01文件，不打包其他未提交实验修改。

## 历史清理（已完成）

用户明确要求删除此前核实的全部prepared.pt。执行前数据库活动Execution=0、未终态TaskRun=0；173个历史Flow修订中无历史prepared.pt S3 URI引用；52条数据集位置中无prepared.pt引用。40个涉及预处理的Flow修订通过同一次执行TASK_OUTPUT绑定消费文件。

`scripts/cleanup-prepared.mjs plan/delete` 保存精确key和size清单，仅删除已知Execution的 `lab/<uuid>/<uuid>/<attempt>/prepared.pt`；删除前复核完整清单，删除后比较全部非目标key/size不变。

| 存储 | 删除数量 | 删除体积GiB |
| --- | ---: | ---: |
| center | 0 | 0 |
| edge-a | 302 | 60.924745 |
| edge-b | 294 | 69.137774 |
| edge-c | 295 | 78.874513 |
| 合计 | 891 | 208.937032 |

证据位于ignored `.local/cea/prepared-cleanup/plan.json`、`deleted.json`。未备份这些临时文件，不能直接恢复，可从原始数据重新生成。未清理数据集、模型、报告、其他上传、镜像、Docker卷或实验环境；Docker VHD文件大小不代表即时归还Windows磁盘空间。

删除后只读核实center/edge-a/edge-b/edge-c四个产物桶的版本保留均为Disabled，不存在删除标记后仍保留旧版本的情况。

## 自动清理范围和验证

协议见[FILE-01增量](../contracts/file01-pod-artifacts.md#流程结束后的临时输出清理art-clean-01)。新增1个业务协调类、1列完成标记及索引；原执行/Worker链不变。新增类满足当前消费者：定期任务调用它；完成标记防止重启后重复扫描整个历史，存储失败不会误标完成。无新增API、Flow语法、表或SPI。

新增TemporaryOutputCleanupTest使用真实MySQL8及MinIO，覆盖：运行中保留、afterExecution未结束保留、多存储/多Attempt清理、只删除确切文件、保留数据集/模型/报告/其他执行/其他namespace、失败及取消/软删除、存储失败重试/重建服务、空配置与拒绝宽泛路径。05:23:29专项5项全部通过，0失败/错误/跳过；初始测试夹具遗漏timeout/command以及临时目录初始化已修正，未改变生产Flow校验。

第一轮完整回归发现两处旧迁移预期未随V34更新：迁移总数32→33（版本号有间隙）、历史行多出默认false的清理列。已明确断言新增默认值并保持其他历史字段逐项不变，停止该轮后重新执行完整verify；首次日志保留`verify-initial.log`。

05:42:24，JDK21 `scripts/verify.ps1`完整通过，耗时18分52秒：runtime38、server265、打包启动IT1，共304项，0失败/错误/跳过。其中容器/Registry/文件传输63项与清理5项均通过。结构检查通过：8模块、114生产Java、32功能ID、1366链接。日志`verify.log`。

用户已授权后端仅限prepared.pt的DeleteObject权限。发布前已确认活动Execution/TaskRun均0，并保存`database-before.sql.gz`（2,919,697字节）、`before-release.json`和`cea/backend:before-art-clean-01`。

05:43，已按用户批准范围更新四个存储的cea-backend策略（旧策略保存`policies-before.txt`），只增加lab/.../prepared.pt的DeleteObject权限。只重建/更新backend，frontend仅重载路由；后端健康，V34迁移成功。`after-release.json`逐项确认原2374条执行结果/结束时间/输出、全部历史Flow源码修订、数据集位置不变，另外19个CEA服务的ID/镜像/启动时间均不变。后端镜像配置ID为7fec96f25437fd4492bbb3f921c78620da5fc58db67fb43d30ed74feb4acba1d。

## 线上验证（通过）

新增唯一专用Flow `art-clean-01-smoke`，沿现有edge-bearing/ep01-v1镜像依次执行edge-a准备、cloud消费、edge-a后处理，不修改旧Flow或契约。执行ID `da8c6d16-06b7-4833-bfab-3f4e52fa4f96`，3个TaskRun全部SUCCESS；后处理运行期间10次S3检查均保留prepared.pt。05:47:17后台记录删除1个临时输出；清理完成标记=1，执行结果/结束时间/输出与清理前完全相同。

保留对象为model.pt、report.json、consumed.txt、after.json；prepared.pt不存在。证据`smoke-accepted.json`、`live-smoke.json`。首次上线按批检查2374条历史，首次清理需等待积压扫描；完成标记避免以后重启重新扫描这些历史。定时任务是每批结束后10秒再次运行，不承诺文件删除的固定时延SLA。

本批不增加页面、不重跑训练、不清理模型/报告/数据集，不清空执行历史或修改计时；公开Git仅提交本批文件，其他未提交修改保留。

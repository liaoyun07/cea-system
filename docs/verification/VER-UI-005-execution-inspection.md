# VER-UI-005 执行数据展示

日期：2026-09-12。状态：PASS，已发布。规格：[UI-05](../features/UI-05-execution-inspection.md)。

验证清单：Node拓扑/作用域/时间/示例；真实JAR浏览器历史修订、Repeat/Loop/If实例输出、Dag、Parallel、失败/重试/取消、SELECT；构建/格式/scaffold；完整Maven含真实FedAvg/FedProx；桌面/窄屏截图；CEA只更新frontend＋两个Flow CAS修订、其它配置/历史/11容器不变。

## 已验证

- Node：36/36；新增Dag/Parallel顺序、非法图拒绝、动态parent＋iteration、失败/重试/取消原状态、不放大时间、两个显式SELECT示例。
- 最终真实JAR浏览器：40/40，1.9分钟，日志 `frontend/.local/UI05-e2e-verified.log`。涵盖固定历史修订/403不回落最新源、两轮两item及If跳过分支、Dag/Parallel、失败两Attempt、取消状态、任务输出/时间、两个SELECT下拉，及既有管理/No-code/分页回归。使用独立临时库/Registry/K3s，不写CEA业务数据。
- 构建及Prettier：PASS。依赖与锁文件未改，Vue/SVG/CSS构建，无第二图模型API。
- check-scaffold：8模块、86 Java索引文件、32功能编号、451本地链接PASS。
- 完整Maven verify：2026-09-12 14:35:02 +08:00 BUILD SUCCESS，11分33秒，215测试，0失败/错误/跳过。包含真实Registry/Kubernetes及FedAvg/FedProx两轮数值回归。未新增生产Java。日志 `.local/UI05-verify.log`；其中远端重连/故障测试告警未导致失败，按实际报告计数，不隐去日志。
- 桌面1440px、窄屏650px：拓扑与详情截图查看，修正分支标签换行、增加面包屑的轮次/item标识；无文档横向溢出。证据 `frontend/.local/evidence/graph-*.png`。

## 测试修正记录

第一轮浏览器39/40：新增SELECT测试误定位不存在的“取消”按钮；改用页面现有“关闭执行参数”，产品行为未改。第二轮39/40：新增重试测试漏写DSL必填的`retry.type: constant`，后端正确拒绝保存；修正测试数据，不放宽校验。第三轮39/40：后处理实时图断言误插入没有后处理节点的日志分页用例；删除错位断言，保留原有独立后处理状态/日志回归。本批图的端到端检查以终态实例为主，运行中仍复用原轮询而非另建刷新机制。最终全量40/40通过，未以只跑通过项替代完整回归。

## 发布边界

CEA基线：FedAvg r4、FedProx r2，四条执行均终态，12个容器。两个目标源的SELECT变更通过服务端validate；保存前再次比对当前修订并使用expectedRevision。14:45 frontend Healthy、nginx -t通过；CAS保存FedAvg r5、FedProx r3，只更改两个输入的type/values。历史源逐版本比对、四条Execution列表/状态/输入/输出及其他11个容器ID/StartedAt发布前后均一致。新修订POST响应为纳秒而DB回读为微秒，一次性核验脚本最初误做字符串全等；仅新createdAt允许≤1微秒精度舍入，其余字段仍严格比较，未更改后端或再次保存流程。

部署只读复核脚本 `deploy/cea/verify-browser.mjs` 增加数据集下拉、历史执行第2轮第3个item的真实train ID/输出/耗时/Attempt、桌面窄屏。不开新执行，不改数据，不以读到引用冒充取得模型或指标文件内容。

实际18080于14:46:19 +08:00复核PASS：两Flow的显式SELECT和旧执行r1拓扑正确，两次训练均可定位第2轮/edge-c的真实train及model.pt引用，耗时与API直接相减一致；桌面和窄屏截图再次检查。目录仍5应用/4集群/2数据集，Application日志仍真实为空；见 `.local/cea/browser/result.json`、`fedavg-round-topology.png`、`fedprox-task-graph-narrow.png`。复核后再次确认历史/其余容器不变。

本批新增3个前端展示/工具文件及1个单测文件，抽出TaskRunDetail复用原尝试区域；没有Java类/字段/表/API/SPI新增或删除，YAML与No-code仍同一事实源。不是旧功能全部迁移或S7完成。

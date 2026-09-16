# VER-PRIO-02：CEA双流程优先级实测

日期：2026-09-17，Asia/Shanghai。生产源码 `6362ed8`，本批仅新增测试Flow、脚本及文档，没有改后端/前端/算法/SDK/数据库结构。

状态：PASS，两次Execution、四个Job均SUCCESS，每个任务只有一次Attempt。以下时间均为2026-09-17北京时间（UTC+8），容器时间来自Kubernetes实际状态，不是TaskRun派发时间。

## 场景

cloud保持两个平台Job槽、Worker24；应用版本httpserver/v1，实际镜像沿用原登记，显式覆盖为Python sleep并打印START/END。

- `priority-occupy`：Parallel中的hold_a持续60秒、hold_b持续180秒。
- 确认两者主容器都在运行后，提交 `priority-compete`：Parallel先声明low(priority10)、再声明high(priority90)，各持续10秒。
- 不给两竞争任务设置依赖，不用Loop并发1限制就绪，也不更改现有资源配置。
- 预期：low先入队，资源满时两者无预约/Pod；A退出后high先运行，high退出后low运行；B不被抢占。

## 证据

占位Execution：`a4348126-1455-4927-9a90-5644a117bb0c`；竞争Execution：`b27869dd-90ca-4909-a3cc-b916ea11ead0`。

01:15:48.992观察到low入队序号25、high为26，二者priority分别10/90，prepared=false、无资源预约、无Pod，A/B仍占满两槽。该瞬间low队列表为RUNNING领取租约、high为READY；不是low已拿到执行名额。01:16:07.402首次观察high预约，01:16:23.984首次观察low预约；轮询观察时间不冒充精确预约时间，容器/Job时间另列。

首次脚本准备请求误用了expectedRevision=null，接口422拒绝，尚未创建Flow/执行；已改为0。开始执行后的观察器把SQL布尔false误断言为数字0而中断，修正为布尔判断后接续观察上述同一对Execution，未取消或重跑业务任务。失败日志与观察记录保留，不补跑挑样本。

## 实际时间与判定

| 任务 | priority | Job创建 | 主容器启动 | 主容器结束 |
|---|---|---|---|---|
| hold_a | 0 | 01:15:01 | 01:15:03 | 01:16:03 |
| high | 90 | 01:16:06 | 01:16:08 | 01:16:18 |
| low | 10 | 01:16:21 | 01:16:22 | 01:16:32 |
| hold_b | 0 | 01:15:01 | 01:15:03 | 01:18:03 |

low先入队但high先获得槽位并创建Job；A主容器结束后才创建high，high主容器结束后才创建low。B在整个竞争期间连续运行180秒，未抢占、未重试。日志的START/END与主容器状态相符。主容器结束到下一个Job创建之间还包含文件助手退出/Job完成确认/结果回收/下一次准入，不能把几秒间隔称为优先级排队错误。

资源回收后原Worker队列和未释放Job预约均为0；原346次执行/42个Flow逐项保持、19个服务ID/镜像/启动时间与配置文件不变。只新增2个测试Flow及2次成功执行，总348次执行、44个Flow；18080可查看 `priority-occupy`、`priority-compete`。无服务重启、无数据库迁移，不改FedAvg/FedProx和资源容量。

Node脚本语法、YAML解析与真实后端校验、实际4个K3s Job、顺序/日志/单Attempt/保留断言通过；文档结构/链接检查通过。本批没有修改生产代码，不重跑完整Maven或前端构建，也不以本次结果替代这些回归。

私有证据：`.local/cea/priority-test-1789578899028/`（before、execution-ids、queued、observations.jsonl、Job/容器日志、result）；`.local/priority-live-test.log`、`.local/priority-live-test-final.log`、`.local/priority-live-observer.log`。

测试源码和拓扑见[示例](../../examples/priority/README.md)。本批不测试吞吐量、CPU利用率或扩大并行量；不重新声称完整Maven/前端回归通过。

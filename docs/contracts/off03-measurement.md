# OFF-03 观测与终端反馈协议

状态见 [进度](../04-progress.md)，取舍见 [ADR-0027](../decisions/ADR-0027-offloading-measured-state.md)。不改变 Flow、Binding 或原 Execution 协议。

## 范围与六维计算

单个无重试卸载 Application、单个终端原始文件；可信网关来源，一个所属边缘和一个配置中心云；同算法/参数/文件格式及固定资源。其余 Flow 可执行，但不生成可训练六维样本。

| 状态 | 计算及真实来源 |
|---|---|
| D | 终端代理核验的实际 bytes / 1048576 |
| QL | 来源终端已选层、未完成或未确认停止的输入 bytes 总和 / 1048576 |
| QE | 所属边缘同口径未完成量 / 1048576 |
| QC | 配置中心云同口径未完成量 / 1048576 |
| TE | bytes/R(终端→边缘存储) + bytes/R(边缘存储→边缘 Pod) |
| TC | bytes/R(终端→边缘存储) + bytes/R(边缘存储→云 Pod) |

R=最近20次成功完整传输的总bytes/总seconds，包括该次实际传输重试等待，不含排队和Pod启动。无历史时null，先用FIXED/RULE标定；不假设带宽或同云零耗时。网络state为逐项log1p。Q不是精确剩余CPU工作量，六维不是严格完备MDP的证明。

Resource接纳事务原子提交Q快照、层决策及工作量；同Attempt接管不累加，原Runner确认完成/停止才释放。有混合配置或未计量活动资源预约则状态不完整，未知不能填0。

## 传输事实

受控网关`storage`操作返回真实ingress bucket，不由Flow指定。`files/materialize`实际上传时返回`transfer:{bytes,seconds}`，从读取终端至S3 PUT完成计时；已存在不可变文件不产生新事实。

Pod授权计划可带`measureInputs:true`。files-in成功下载后写最多4KiB termination message：`{"transfers":[{"name":"signal.csv","bytes":100,"seconds":0.12}]}`（仅格式示例）。原KubernetesJobRunner读取成功init消息；适配层核对Prepared文件名与物化时已核验并冻结的单文件实际大小，不为计量额外请求源S3 HEAD；resource按Attempt+阶段+文件去重。没有算法SDK、新回调凭据或pods/exec权限。缺失报告不伪造速率。

## 端到端反馈

终端`POST /v1/executions/{executionId}/feedback`，Bearer身份不变。网关转交`POST /api/namespaces/{namespace}/edge-access/terminals/{id}/executions/{executionId}/feedback`。

请求`{"outcome":"SUCCESS","elapsedSeconds":12.5}`（格式示例）；平台204，网关200 `{}`。仅CONNECT原网关/原终端/原Execution可写；同值重传成功，冲突409，不符合采样范围或结果不符422。SUCCESS/FAILED/CANCELLED核对实际Execution，SUCCESS还校验声明的成功JSON产物。

终端同进程`perf_counter_ns()`从首次POST compute前到已接收解析结果；含请求、队列、上传、Pod启动、算法、输出、轮询、结果读取。不跨机相减。先保存回执再发反馈，丢ACK重传原值；进程重启丢失原始计时则`UNMEASURED/null`，不重新测一小段代替全程。反馈失败不改变真实业务结果。

示例时限120s：成功且elapsed≤120时reward=-elapsed/120；失败或超时-2；取消/缺测无reward。客户端最长查询240s，成功晚于120s也按TIMEOUT奖励。超时反馈不代表容器已停止，不提前释放Q。不是30ms申报指标。

## 下一状态与消费者

同namespace、所属边缘、策略、算法版本及参数，按接纳决策顺序固定A.next=B，不按完成顺序关联。每个结果只补自己的execution。连续流尾项无next不能训练，不伪造done；显式批次关闭/Double DQN留到OFF-04。

原`GET /offloading/samples`新增measurement：原始六维、来源/策略、合法动作、缺失原因、nextKey/nextState、耗时/反馈/时限/trainable。18080“卸载观测”列表与详情是消费者；完整不等于已训练。旧记录measurement=null，旧13维不转换。

## Migration和字段消费者

- V26 `res_offload_workload`：allocation去重/释放；layer/scope决定Q范围；profile识别混合配置；bytes累加；released供完成排除/取消墓碑。
- V26 `res_file_transfer`：Attempt/阶段/文件去重；source/target分路径；bytes/seconds计算R；sequence决定最近20次。
- V27原`off_task_observation`：sample_no决策顺序；origin_edge/terminal/flow_id决定来源授权和决策流；raw6/legal/unavailable决定事实/完整性；next_allocation_id关联下一决策；elapsed/limit/feedback_outcome/reward决定端到端反馈与奖励展示。

无新Execution/Worker/DQN状态表、调度器或SPI。

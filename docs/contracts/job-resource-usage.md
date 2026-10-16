# Job资源消耗协议

## 持久化

V35为 `wf_task_attempt` 增加可空JSON列 `resource_usage_json`。键仍为task_run_id+attempt_no，无新表；旧历史保持NULL。

`JobResourceUsage` 包含jobName/jobUid/namespace/podUid及containers；namespace为实际Kubernetes命名空间。每个容器包含name、status、cpuCoreSeconds、memoryByteSeconds、durationSeconds、peakMemoryBytes、samples。status为COMPLETE/MISSING/INCOMPLETE/INVALID；缺失或无效值是null，不是0。CPU计数、内存积分定义见[功能](../features/JOB-USAGE-01.md)。

Worker结果新增可空resourceUsage。Executor在消费结果的原事务里写入Attempt，然后删除临时Worker结果。正常失败和重试摘要不覆盖前一次；服务重启仍可查询。旧JSON结果不含字段继续可读。

## 读取

`GET /api/namespaces/{namespace}/executions/{id}/resource-usage`

沿用Namespace READ和Execution归属校验。原Attempt接口同样返回可空resourceUsage。

返回status、attempts、completeJobs、durationSeconds、cpuCoreSeconds、memoryGiBSeconds、averageMemoryGiB、observedCpuCoreSeconds、observedMemoryGiBSeconds、jobs。jobs逐项含taskRunId、taskId、attemptNo、state、usage。

- COMPLETE：流程和全部任务已结束，计入的各Attempt三个容器均完整。
- RUNNING：尚未全部结束；只有observed字段包含已回收容器的下界，不作为最终总量。
- INCOMPLETE：结束但只采集到部分容器；完整总量和平均值null，保留observed及缺失明细。
- UNAVAILABLE：应有Job但没有完整容器摘要，例如部署前历史。
- NOT_APPLICABLE：没有Kubernetes Job的流程。

只有COMPLETE填总量和平均内存。内存积分以GiB·s返回（1GiB=2^30字节），CPU为核秒；不是CPU百分比、内存配额或输出文件字节数。重复调用只查询/计算，不更新数据；执行中不返回实时容器曲线。

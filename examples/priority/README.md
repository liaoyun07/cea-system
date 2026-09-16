# CEA 优先级实测

只新增两个普通 Flow，复用 `httpserver/v1` 镜像和既有执行链，不运行其默认 HTTP 服务，不改并发配置。

```text
priority-occupy
  Parallel
    hold_a：cloud，运行60秒
    hold_b：cloud，运行180秒

确认两个主容器均运行后，提交：
priority-compete
  Parallel
    low ：cloud，priority=10，运行10秒（故意先写）
    high：cloud，priority=90，运行10秒
```

条件：CEA空闲、cloud有2个平台Job槽，两个候选流程ID尚不存在，已有 httpserver/v1。容器运行 Python sleep 后正常退出；不是CPU压测，不生成算法计量。

执行 `node examples/priority/run.mjs`（Node、Docker在PATH）。脚本通过正常API校验/创建Flow并提交执行，只读SQL队列/预约、Kubernetes Job/Pod和日志。确认占位主容器运行后才提交竞争流程；保留两次执行及所有证据，不删除历史、不修改已有Flow、不重启服务。

预期：low入队序号小于high；等待时二者均没有预约/Pod；A结束后high先创建Job，high结束后low才创建Job，此期间B一直运行。不能用TaskRun.startedAt证明容器启动顺序，因为它在派发入队时已记录。队列表短暂RUNNING仅表示领取租约，不等同于获得Worker执行名额。

私有证据保存在 `.local/cea/priority-test-<timestamp>/`。若观察脚本中断且两个Execution已创建，可用 `node examples/priority/run.mjs priority-test-<timestamp>` 接续观察同一次测试；不会重新提交。首次运行发现同名Flow会停止，不自动覆盖或删历史。已保存的两个流程可以在18080页面查看；人工复测时须先确认占位任务运行且槽位确实满载。

本次实际结果见 [PRIO-02验收](../../docs/verification/VER-PRIO-02-live-priority.md)。

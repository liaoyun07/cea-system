# OFF-02：联网终端经网关计算

状态：2026-09-14已测试并发布CEA，见[验收](../verification/VER-OFF-002-terminal-gateway.md)。原EP-01上传事件不改为compute，不覆盖已有策略。

## 正常链

```text
终端本地固定文件 → 网关 POST /v1/compute（只发元数据）
  → 原 edge-access events → 原策略 Flow / Execution
  → Executor → Worker → ApplicationTaskRunner
      → FIXED/RULE 选层 → Resource 预约
          TERMINAL → 网关 → 终端代理 → 独立 Docker 引擎
                     原始文件不离开终端；JSON输出获单对象PUT授权写所属边缘
          EDGE/CLOUD → 网关读终端文件、写所属边缘S3
                     → 原 Placement / K8s Job / Pod助手读取 → 输出先写执行本域
  → 原Execution提交输出 → 网关查询授权JSON → 返回终端
```

CLOUD任务直接读取已授权边缘输入，不强制拷贝中心；这沿用FILE-01，不新增交接状态机。中心只控制和有界读取结果。当前RULE仍在现有后端适配链决策，不冒称已部署边缘DQN服务。

## 公共网关请求

`Authorization: Bearer <已登记终端token>`；token绑定终端，不能传terminalId/cluster/URL。

```json
{"requestId":"<UUID v4>","eventType":"offload-edge","file":{"fileId":"<本地不可变文件UUID v4>","bytes":1507314}}
```

POST `/v1/compute`：仅允许配置的computeEvents；先经代理检查本地文件大小，不读原始字节。转换为原事件`inputs.data_file`，requestId用作已有edge_submission幂等键；202含executionId。重复同请求返回原执行，改内容409。原文件必须在提交前固定，不允许复用fileId覆盖内容；异常时保留收据，不换键盲重试。

GET `/v1/executions/{id}`沿用原接口。成功terminal_result通过新增后端GET `/api/namespaces/{namespace}/edge-access/terminals/{id}/executions/{executionId}/result`解析为本执行成功TaskRun/Attempt声明的JSON，限制256KiB。CONNECT及网关/终端归属先校验，不能用任意URI读对象；支持云或边缘产物。无二进制结果下载、回调、ACK或离线补发。

## 文件、动作与连接

- 既有Binding解析出的inputFiles值新增`{fileId,bytes}`描述；仅可信TERMINAL+gateway配置允许。普通CLUSTER仍只接S3 URI/URI数组。
- 本批单文件1..64MiB；网关终端输出只接.json，单个256KiB。S3数据集/命名输入仍沿原规则，代理有64MiB输入上限。
- `offload: {strategy: FIXED, layer: TERMINAL|EDGE|CLOUD}`：合法候选中选指定层，缺少该层直接失败，不静默回退。RULE不得带layer；DQN/modelVersion仍禁止。
- `platform.jobs.terminals.<namespace>.<terminal>.gateway: {endpoint,tokenFile}`及slots：服务端部署配置，不是Flow参数；与原dockerContext互斥。网关`agents`固定终端→代理连接，controlToken与终端令牌分开。
- Prepared新增terminalFiles/gatewayTerminal；消费者为文件准备、网关派发与释放实际终端预约。仅保存稳定描述，不保存连接口令和签名URL；重入重新签发。
- 代理容器按TaskRun/Attempt固定命名，不重跑已退出容器。持久plan用于防同Attempt改配置；cancelled标记防止取消后迟到创建。结果不明保留同Attempt接管；确认容器停止后才释放名额。没有第二套重试或Execution状态。

## 部署限制

CEA terminal-agent与terminal-engine共享专用工作卷/socket；socket来自独立DinD，并非宿主Docker。只有engine特权；不发布DockerTCP端口。仅稳定联网Linux模拟终端，不支持物理设备认证协议、离线恢复、终端间转移、任意终端调度或DQN。原Docker Context路线仍按显式配置回归，不作为网关失败的回退。

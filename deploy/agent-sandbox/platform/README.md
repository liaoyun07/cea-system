# 服务部署预热接入

前置：中心云已安装 Agent Sandbox v1.0.2 与 DEP-WARM-03 的 WarmService CRD。此目录不安装/升级集群级 CRD，不修改边缘集群。

`warmservice-crd.yaml` 仅归档当前已有定义，供另一个环境安装前核对；命名空间安装器不会执行它。

用户批准对应命名空间权限后，`node deploy/agent-sandbox/platform/install.mjs --apply` 安装 namespace-scoped adapter；不加参数只列出目标。首次范围固定 cea-lab 与 cea-lab-warm-ui-20261018。既有预算不会在再次安装时重置。代码 ConfigMap 更新后，需要重建本目录的 adapter Pod 才载入新代码。

后端 `platform.deployment.warm-scopes` 配置包含 `{namespace: lab, cluster-id: cloud, kube-namespace: cea-lab}` 和已批准的独立测试命名空间。缺省为空，原部署保持常规模式。

在原部署页面选择 HPA 与预热开关，沿原入口配置 Service/Ingress。原生 HPA 写 WarmService `/scale`；adapter 创建/删除 Claim，Agent Sandbox 领取/创建实例并补池。业务 Service selector 包含 `sandbox.users.io/online=true`；备用实例不处理业务流量。

动态入池使用真实近期扩容需求、Pod 创建到首次观察 Ready 的时间和模板内存上限，无应用名白名单或命中率参数。初始4个/2048MiB预算可在页面调整，每应用最多2个。共享纯函数/namespace REST 客户端来自 `../hpa/core.py`、`../hpa/kube.py`；旧实验配置和结果不改。

测试：`python -B -m unittest discover -s deploy/agent-sandbox/platform -p test_adapter.py`。真实 HPA、页面、Flow、配置更新与回收已经验证；具体证据及环境限制见 `docs/verification/VER-DEP-WARM-04.md`，历史协议见 `docs/contracts/deployment-warm-pool.md`。两个命名空间各自管理预算；现有部署不会被自动转换为预热模式。

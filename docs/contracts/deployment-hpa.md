# DEP-HPA-01 接口

路径 `/api/namespaces/{namespace}/clusters/{clusterId}/kubernetes/namespaces/{kubeNamespace}/deployments/{name}/autoscaling`：

- GET：READ，返回HPA投影；不存在返回enabled=false、editable=true、空metrics/conditions，其余null。查询失败不当作未启用。
- PUT：WRITE，创建/更新返回200。新建resourceVersion=null，更新使用GET值；控制器状态更新也可能引起版本冲突，重新读取再提交。
- DELETE：WRITE，query resourceVersion必填，成功204。只删除本部署所属HPA，不改实际副本。

```json
{"minReplicas":1,"maxReplicas":3,"cpuUtilization":60,"memoryUtilization":null,"resourceVersion":null}
```

响应：enabled、editable、name、resourceVersion、minReplicas、maxReplicas、currentReplicas、desiredReplicas、lastScaleTime、metrics、conditions。metrics元素为 `{resource:"cpu"|"memory",targetUtilization:60,currentUtilization:null}`，缺失不补0。外部/重复/不支持的配置enabled=true、editable=false，不能覆盖。

部署PUT在HPA存在时忽略传入replicas、保留实际值，仍以Deployment resourceVersion条件替换。PATCH scale在HPA存在时409。HPA范围/requests/零副本校验422，所有权或版本冲突409；原401/403/404不变。无数据库迁移或新dep_deployment_record事件。

# UI-09 Registry / Kubernetes 管理协议

以[OpenAPI](openapi.json)为字段事实源。路径统一以`/api/namespaces/{namespace}`开头；READ查询、WRITE变更。工作空间权限不等同于任意Kubernetes Namespace权限。

可编辑请求示例：[ui09-resource-management.http](../../examples/ui09-resource-management.http)。示例不会自动执行，尤其不会自动为现有示例部署创建访问入口。

## Registry

- `GET /registries`：配置中心及分发目标允许当前工作空间访问的仓库。
- `GET /registries/{registry}/repositories?last=`：Distribution `_catalog`分页，过滤`namespace/`前缀；空页仍可有next。
- `GET /registries/{registry}/images?repository=`：现场核验标签及已知无标签digest。候选来自分发目标历史、直接指向该仓库的契约，以及同名应用契约摘要对应的`namespace/applicationId`分发目标路径，因此不依赖历史记录已存在。历史和目录不是库存事实；任意外部匿名digest无法通过标准V2接口完整枚举。
- `GET /registries/{registry}/image?repository=&digest=`：manifest/config过滤后的平台、构建时间、压缩层字节与删除阻碍。不返回ENV、命令中的秘密或认证文件。
- `DELETE /registries/{registry}/image?repository=&digest=&confirmation=`：confirmation精确等于repository@digest；重新检查引用后DELETE manifest，再读验证不存在。关联标签失效，不直接删除blob，不宣称磁盘空间已释放。
- 支持当前CEA匿名/htpasswd Distribution服务。管理`api-url`默认按address/tls-verify推导HTTP或HTTPS；可为同一仓库的管理网络配置单独origin，例如隔离测试的宿主机端口。认证文件沿用已有auth-file；不支持凭据辅助程序或Bearer token管理接口。HTTPS按JVM信任库验证，不关闭证书检查。
- Registry响应上限2MiB；每仓库路径最多5000标签，超限/异常不是空库存。公网重定向不带凭据跟随。

## 应用目录

`DELETE /applications/{applicationId}/versions/{version}`检查所有保存的Flow修订（包含策略、嵌套和历史修订）及实际工作负载。可移除时只将`dep_application_version.deleted`置true，get/list不再返回，register/upload拒绝复用该版本。保留旧contract_json和分发/部署证据；历史查询不要求目录仍存在。单独删除Registry内容仍需再次现场检查。

保留契约中的镜像引用仍由ApplicationCatalogService提供给Registry库存查询作为候选（包括目录已移除、没有分发历史的副本）；每个候选仍须现场查询manifest。契约为tag时，只通过当前工作空间获准访问的已配置源Registry解析当前digest；源标签不可验证时返回错误，不以空列表声称没有副本。未记录且源标签已改变的旧digest仍属于无法完整枚举的范围。该内部读取不恢复目录项，不参与执行契约解析，也不会将已删除目录项当作活动删除阻碍。

该管理检查不是跨MySQL、Registry和Kubernetes的分布式事务。清理应在没有同时编辑相关Flow、上传、分发或变更相同工作负载的窗口执行；不承诺阻止外部管理员在检查后并发创建引用。受保护的现有Flow与工作负载不会为了删除被自动更改。

## Kubernetes

`/clusters/{cluster}/kubernetes/namespaces`支持GET/POST；`/{kubeNamespace}`支持DELETE。

范围包含连接中原有默认Namespace和标记`cea-system/owner=cea-system`、`cea-system/namespace=<工作空间>`的新Namespace。创建名称必须`cea-<工作空间>-...`；既有同名对象不会收编。默认Namespace不可删除，含Pod、ReplicationController、Deployment/StatefulSet/DaemonSet/ReplicaSet、Job/CronJob、PVC时不可删除。Namespace DELETE本身是级联异步操作，剩余配置/自定义资源受Kubernetes删除控制器管理；客户端确认清楚后提交，不清finalizer，不伪称已经完成。

`/{kubeNamespace}/services`支持GET/POST；`/{kubeNamespace}/services/{name}`支持GET/DELETE。创建支持selector、1..32端口、TCP/UDP/SCTP、数字或命名targetPort及ClusterIP/NodePort/LoadBalancer，省略nodePort交Kubernetes分配。只删平台所有Service，客户端必须提交当前uid和resourceVersion；列表可查看范围内非托管Service，但不因此有删除权。

详情地址来自实际Service/Node状态，未分配LoadBalancer地址不伪造；Pod按selector查询、Ready取实际Condition。节点InternalIP不代表Windows浏览器可达，Service DNS命名不代表部署了DNS解析器。UI-09时未启用CoreDNS/ServiceLB/Ingress；ING-01新增的HTTP入口见[协议](ingress.md)与[发布状态](../verification/VER-ING-01-ingress.md)，CoreDNS/ServiceLB保持原状。

原`/kubernetes/services`和`/kubernetes/namespace`是默认连接范围的只读快捷查询，仍调用同一Kubernetes连接；新管理页使用显式Namespace路径，不维护第二份资源状态。Runner/Job/Deployment原执行范围不变。

权限：新ClusterRole允许Namespace/Service创建、读取、删除以及工作负载/PVC读取；Kubernetes RBAC不能按名称前缀限制create或按所有权标签授权，工作空间/所有权约束在管理服务中强制校验。后台凭据范围扩大，不能把它描述成Kubernetes层的硬租户隔离。默认执行Role中的部署/Job写权限仍只限原Namespace。

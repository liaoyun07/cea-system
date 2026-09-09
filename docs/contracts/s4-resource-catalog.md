# S4-01资源目录与候选位置接口

本批为声明式目录和只读检查，不连接集群、探测对象、预留资源或创建Job。完整S4状态见[工作包](../features/S4-resource-runtime.md)；字段以[OpenAPI](openapi.json)为准。

## HTTP与权限

统一前缀/api/namespaces/{namespace}/resources，复用Basic及namespace READ/WRITE。body不接受actor或namespace。

| 方法和后缀 | 权限 | 返回 |
|---|---|---|
| PUT /clusters/{clusterId} | WRITE | 200；注册/更新，id必须匹配路径 |
| GET /clusters/{clusterId} | READ | 200；未知404 |
| GET /clusters | READ | 按id排序分页 |
| PUT /datasets/{datasetId}/versions/{version} | WRITE | 200；首次或相同内容重放；不同内容409 |
| GET /datasets/{datasetId}/versions/{version} | READ | 200；未知404 |
| GET /datasets | READ | 按datasetId/version字典序分页，不推断最新版本 |
| POST /placement-options | READ | 200；只读检查，不启动任务 |

分页limit默认20、范围1..100；offset默认0、范围0..1000000。非法JSON/未知字段400，无身份401，越权403，参数非法422，基础设施失败500，不伪造成功。

## 注册内容

集群：

```json
{"id":"edge-a","kind":"EDGE","enabled":true}
```

kind为CLOUD/EDGE；enabled默认true，可禁用。它是管理员开关，不是实时健康状态；没有无消费者的endpoint、密钥或观测字段。

数据集版本（先注册全部集群）：

```json
{
  "datasetId":"mnist","version":"v1","format":"pt",
  "locations":[
    {"clusterId":"edge-a","uri":"s3://datasets/mnist/v1/edge-a/data.pt"},
    {"clusterId":"edge-b","uri":"s3://datasets/mnist/v1/edge-b/data.pt"}
  ]
}
```

当前注册描述的format和locations不可覆盖；同内容重放忽略位置顺序，修改使用新版本。版本指注册描述，不宣称底层对象内容已做不可变校验。没有新增hash或自动版本字段。locations为1..100条，同namespace内clusterId必须存在且不可重复；允许注册disabled集群，检查候选时才拒绝使用。

namespace/clusterId/datasetId首字符为字母，其后允许字母/数字/点/下划线/连字符，最多100字符；version允许字母或数字开头，最多100；format最多64，大小写严格匹配。

URI只接受s3://bucket/key，也可定位S3兼容对象存储的数据；禁止账号密码、query、fragment、port和父级路径。它不是HTTP endpoint。本批只存对象标识，不上传、复制或探测对象，不能据此证明对象存在。对象存储连接及Runner传输后续实现，不自动兼容旧minio://逻辑。

## 候选本地性检查

```json
{
  "candidateClusterIds":["edge-a","edge-b"],
  "datasets":[{"datasetId":"mnist","version":"v1","requiredFormat":"pt"}]
}
```

必须显式给出1..100个不同候选集群；datasets可空，最多100项，不允许重复datasetId/version。同一集群必须满足所有指定数据集版本要求，不能把两个集群各有一份数据误认为其中一个可执行。

PlacementOption按候选输入顺序返回clusterId/kind/eligible/reasons/datasets。拒绝原因可以累计：CLUSTER_DISABLED、FORMAT_MISMATCH:datasetId/version、DATASET_NOT_LOCAL:datasetId/version。datasets返回该集群已经声明的位置；只有eligible=true才通过全部目录约束。

未知候选或数据版本404，不悄悄跳过或改用其他版本。requiredFormat省略只表示本请求不限制format，不代表绕过后续镜像契约。此结果仅供预览，不是事务性资源承诺；派发前还须再次校验并冻结运行位置。健康、CPU/内存容量、原子预约和真实可达性尚未参与判断。

## 所有权与消费者

| 新增结构 | 当前消费者 |
|---|---|
| Cluster / res_cluster | 注册/列表/禁用；候选使用kind和enabled |
| DatasetVersion / res_dataset_version | 不可变版本注册与格式匹配 |
| Location / res_dataset_location | 位置注册、同namespace组合外键、本地性检查和URI返回 |
| DatasetRequirement / PlacementRequest | 指定本次全部集群和数据约束 |
| PlacementOption / DatasetLocation | API返回可用位置与具体拒绝原因 |
| ResourceException | 资源422/404/409映射，不使resource依赖workflow异常 |

ResourceCatalogService为授权公共门面，JdbcResourceRepository只操作res_*表。版本及全部位置同事务；部分位置写失败整体回滚，并发同内容重放只形成一份记录。新V6只新增3张目录表，总业务表13张，不改变Execution/TaskRun/Attempt或S3执行器。

当前资源管理链与执行链未连接：HTTP→ResourceController→ResourceCatalogService→JdbcResourceRepository。S4-02接入镜像契约，S4-03才实现观测/原子预约/K8s Job并将目录约束用于真实派发；P04/P06/P11仍未完成。此处没有Runner空接口或没有任务消费者的预约表。

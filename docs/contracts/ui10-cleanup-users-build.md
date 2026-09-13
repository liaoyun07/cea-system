# UI-10 删除、人员与在线构建协议

以[OpenAPI](openapi.json)为结构契约。业务路径前缀`/api/namespaces/{namespace}`；继续Basic认证，默认仅回环入口，没有公开互联网/TLS/SSO承诺。

## 删除与快照

| 操作 | 权限/保护 | 保留 |
|---|---|---|
| DELETE /flows/{flowId}?expectedRevision=n | WRITE；仅USER；修订CAS；活动Execution或非终态TaskRun拒绝；锁Flow头与调度，删除未来schedule | 版本、历史快照和幂等身份，ID不可复用 |
| DELETE /executions/{id} | WRITE；Execution及全部TaskRun均终态，含afterExecution | 原始记录、日志/计量/产物与request key；不删除Pod |
| DELETE /resources/datasets/{datasetId}/versions/{version} | WRITE；未删Application的DatasetRule.allowed引用阻止删除；与登记共用事务锁 | 原始文件、Location及版本身份，不可重用版本 |
| GET /executions/{id}/definition | READ；未删除Execution | 当次实际定义快照，不查当前Flow |

删除是列表和正常查询的逻辑移除，不等于回收磁盘。不新增restore/purge接口。已删除对象404；活动/引用/修订冲突409；相同已接受Idempotency-Key仍返回原executionId，但已删历史详情404，不产生重复运行。Flow删除后未删除Execution仍能查看状态图、TaskRun和输出；历史删除后上述入口均404。

## 人员

GET /me；PUT /me/password；GET/POST /users；PUT /users/{name}；PUT /users/{name}/password。只有ADMIN管理账号，完整目标namespace集合必须在管理员授权范围内；不能给自己停用、降级或移出当前namespace。USER只管理自己的密码。新ADMIN/USER均有已授权空间的READ/WRITE/EXECUTE，不提供细粒度角色配置；既有只读配置账号保留action约束。

sec_user：name是认证身份；password_hash用于密码验证；role决定用户管理；enabled拒绝登录；namespaces_json约束业务/账号范围；actions_json延续AccessPolicy和既有只读账号。无闲置列。配置中的人员账号只在首次初始化导入，后续不覆盖DB密码/权限；CONNECT机器账号继续外置，不进入人员管理。改密后旧密码立即失效，页面退出；密码至少10字符、至多72 UTF-8字节。停用不抹去已接受任务的身份；修改namespace/action仍改变后续授权判断。

GET /health无认证，仅检查DB并返回UP/503 DOWN，不依赖首次管理员密码，改密不会误报容器健康。

## 在线构建

POST /applications/{applicationId}/versions/{version}/build，multipart包含JSON `contract`（ImageUploadRequest）和ZIP `file`。namespace/applicationId为小写OCI标识。ImageBuildResult返回不可变application和至多65536字符日志；失败不登记，日志不持久化。客户端断开后构建/导入仍可能完成，应查询版本确认，不宣称浏览器关闭即取消。

ZIP根目录必须有Dockerfile；100MiB压缩、512MiB展开、10000文件、500字符路径；拒绝越界/重复项，不恢复链接或宿主权限，Dockerfile自行chmod。单服务并发1，默认10分钟、最大配置20分钟，linux/amd64；导出Docker归档≤2GiB，调用已有ImageUploadService中心仓库导入/摘要固定/登记。导入后DB失败可能留下未登记manifest，沿既有管理检查，不宣称跨Registry/DB原子事务。

BuildSettings消费者：command是管理员配置buildctl命令；directory是受控临时根；timeout限制进程，均不可由请求覆盖。不传Registry/DB/S3凭据到builder，暂不支持私有基础镜像凭据。独立rootless容器/网络/缓存，与后端仅共享UNIX socket，不挂宿主Docker socket；可信实验室场景，非敌对多租户沙箱。不新增构建队列、Runner或状态表。

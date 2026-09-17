# UI-19 分发历史查询

- 新增 `GET /api/namespaces/{namespace}/image-distributions?limit=20&offset=0`，返回当前平台工作空间全部分发历史数组。`limit` 为1～100，`offset` 为0～1000000，默认20/0；越界422。
- 工作空间READ权限与原历史查询相同，未登录401、越权403。不能跨工作空间聚合。
- 原 `GET /api/namespaces/{namespace}/applications/{applicationId}/versions/{version}/preparations` 保留，作为应用版本筛选及应用详情的查询入口。原准备镜像POST路径不变。
- 共用 ImageDistribution 响应和已有表；按 `started_at DESC,id DESC` 数据库分页，不依赖应用仍在目录中。未完成且超过deadline的记录仍按既有逻辑读为UNKNOWN。
- 前端每次选择条件归零offset，取消旧请求并仅接收最新请求结果。加载/失败清空旧行，避免显示与筛选条件不符的旧数据。选项为空表示全部，不表示未选择。
- 每页展示20条，查询21条以判断是否有下一页，下一页offset仍增加20；记录数恰为20的整数倍时不会多出一页空结果，不额外执行COUNT或遍历目录。

无数据迁移、新权限或执行链变化。历史仅记录原有实际分发尝试，不把镜像命中复用伪造为一次分发。

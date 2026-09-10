# ADR-0010 S4-04 通用任务最小闭环

2026-09-10，ACCEPTED。用户已授权剩余S4。继续使用同一Worker/Attempt/Binding，不引入插件扫描或另一套执行服务。

参考Kestra官方[HTTP Request](https://kestra.io/plugins/core/http/io.kestra.plugin.core.http.request)、[MySQL Query](https://kestra.io/plugins/plugin-jdbc-mysql/io.kestra.plugin.jdbc.mysql.query)和本地0354ddf8 RunnableTask/TaskRunner：任务声明配置及输出，Worker调用，脚本通过Runner隔离。本项目当前有意简化为HTTP GET/POST、参数化只读SQL SELECT、Application容器中的Shell/Python。不是迁移Kestra全部协议/数据库/脚本插件。

- HTTP连接和SQL连接由管理员按namespace登记在外部配置，不在Flow中允许任意宿主地址或数据库凭据。HTTP返回statusCode/body，SQL返回rows/size；限制返回体积和查询时间。沿用显式Binding提供路径、body或SQL参数。
- GET和只读SELECT允许租约接管重新读取；不承诺读取结果跨时间一致。POST在发送前持久标记，接管遇到该标记返回“外部结果未知”，不再次发送；POST禁止自动retry。远端HTTP副作用不能靠本地超时撤销，不伪称exactly-once。
- SQL只支持SELECT和只读事务，要求配置只读业务库账号，不能连接平台元数据库执行用户查询；不开放DDL/DML或多语句，后续真实写入需求需另定未知提交结果语义。此为当前阶段有意简化，不把未支持写入说成已经支持。
- Shell/Python直接使用S4-03的Application命令argv和文件契约，不另造一套脚本执行模型；用真实Python镜像验证。脚本不在宿主运行。

不新增表、API或领域状态。HTTP首次发送标记使用已有Worker prepared_json（具体消费者为POST防盲目重投），没有新的幂等key。S4-05继续补真实进程/数据库故障验收及部署说明，S5不进入。

# S4-04 HTTP、SQL与隔离脚本

通过既有Flow/Execution API运行，无新HTTP管理路由。实现范围：HTTP GET/POST、MySQL参数化只读SELECT、Application容器Shell/Python。不是所有HTTP方法/数据库写入/脚本插件的全集。

```yaml
tasks:
  - id: request
    type: core.Http
    timeout: PT10S
    http:
      connection: reporting
      method: GET
      path: {source: LITERAL, value: report}
  - id: query
    type: core.Sql
    timeout: PT10S
    sql:
      connection: business
      query: 'SELECT name FROM devices WHERE id = ?'
      parameters: [{source: INPUT, name: deviceId}]
```

Flow作者仍须显式定义inputs.deviceId；例子不会自动派生输入。Http.path/body、Sql.parameters沿用四种Binding来源及上游依赖校验。HTTP输出statusCode/body；SQL输出rows/size，列名必须唯一，SQL NULL保留为JSON null。数字/布尔/字符串保留，其它JDBC值转字符串。

HTTP只允许访问管理员配置的同源、同base路径端点，不跟随跳转。请求/响应最多1MiB，2xx才成功，timeout涵盖本地请求等待。POST发送前写Worker传输标记：Worker接管后发现已开始发送但没持久结果，明确失败并报结果未知，不重发。POST不允许retry配置。GET可以重新读取。HTTP超时不能撤销远端已经产生的副作用，手工再次提交前应检查远端结果。

SQL使用PreparedStatement，只有单条SELECT、只读事务、最多1000行/100列/约1MiB结果；queryTimeout/socketTimeout均启用。管理员必须配置独立业务库只读账号，不得给Flow作者平台元数据库或DDL/DML权限。当前不支持写入/事务提交结果恢复、流式大查询和多种JDBC方言，不将这些未实现能力标为支持。

```yaml
platform:
  jobs:
    http:
      lab:
        reporting:
          base-uri: https://report.example.invalid/api/
          authorization-file: /run/secrets/report-authorization
    sql:
      lab:
        business:
          url: jdbc:mysql://business-db:3306/business
          username-file: /run/secrets/business-reader
          password-file: /run/secrets/business-password
```

authorization-file可省略，设置时内容为完整Authorization头。密码文件必须在所有Worker可读，不能把其内容写进Flow或仓库。缺少namespace连接明确失败，不回落到平台数据库或用户默认连接。

Shell/Python不新增重复Task类型：登记包含所需解释器的Application，通过container.command指定`[sh, -c, ...]`或`[python, -c, ...]`，使用[S4-03文件协议](s4-job-execution.md)。它们与算法镜像使用相同Job、Attempt、产物、取消和接管链；不调用宿主Shell/Python。

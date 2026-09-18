# VER-DEV-001 IDEA 本地接入

2026-09-18，源码基线cfbfa5b；仅新增开发运维脚本和私有生成配置，业务Java/前端代码不改。Windows JDK21.0.12.1、Node24.19、现有CEA。实际使用当前已部署版本对应JAR测试；没有重新构建Java或重跑完整Maven回归，不把既有结果当本批测试。

## 验证

- 路径转换2项Node测试通过：Windows路径/空格、archive、authfile、build上下文/输出及镜像身份保持。
- 两个辅助容器健康，11个新增端口仅绑定127.0.0.1；未挂宿主Docker socket，原BuildKit socket和受限凭据复用。
- 本地后端启动、Flyway29版本无新迁移。只读连接阶段44 Flow、71应用版本、350执行、14数据集逐条与原API一致；四集群Namespace及10个部署读取正常，四Registry库存可读；历史联邦SDK报告与S3回读AVAILABLE。
- 本地Java真实在线构建scratch小镜像、docker archive导入、Registry入库和应用登记成功；已删除仅本批临时应用idea-build-52a311ff及其新镜像manifest，不执行存储GC。
- 本地Java在edge-b创建idea-check-52a311ff Deployment并达到1/1 Ready，随后删除该临时Deployment；现有部署不改。
- 停止原Docker后端后启用本地Executor/Worker/Scheduler，四集群顺序流程idea-connect-52a311ff执行SUCCESS（67921ed3-a11d-437d-9d5b-fcba8b2014c3）；真实镜像准备、Job、文件助手、中心→edge-a→edge-b→edge-c交接，四个JSON结果逐项一致。保留此测试Flow/执行/四个完成Job和小文件作为联通证据。
- 网关使用原CONNECT账号回连Windows后端，heartbeat返回edge-a。

生成的IDEA配置引用私有文件，未在IDEA GUI内点击运行；本机使用同JDK、同配置、当前打包程序启动并验证。IDEA首次源码编译取决于本机Maven索引状态。

私有基线/结果/日志位于.local/idea-cea，不包含在提交中。

## 页面、恢复与保留检查

- 本地Vite18100→本地Java18185：真实浏览器登录、现有应用列表加载通过，截图保存在私有目录。首次探针等待不在第一页的httpserver超时；改为验证第一页真实表格行后复测通过，不涉及产品代码修改。
- Windows→网关→终端代理的available请求通过；网关→Windows后端CONNECT heartbeat通过。未重新跑完整DQN训练/三层卸载性能对照。
- 本地测试JVM和Vite已停止；switch.mjs docker恢复原后端和原网关配置，18080重新可用。两个新开发辅助容器保持就绪，用户按操作说明切到IDEA；未留下占用18100/18185的测试进程。
- 恢复前后逐条确认原44 Flow、71应用版本、350执行、14数据集记录不变；仅保留一份命名联通Flow及一次成功执行，当前45/71/351/14。原20个CEA容器ID/镜像未变，除获授权的backend和edge-gateway外，另18服务启动时间也未变。
- scripts/check-scaffold.ps1通过：8模块、109 Java文件、32功能ID、1088链接；不代替业务测试。生成凭据文件和IDEA配置经git check-ignore确认不进入版本库。

## DEV-01a 按钮启动追加

2026-09-18，基线0345edd。用户要求直接点IDEA按钮启动，新增npm有限任务映射与3份生成配置（Prepare、Restore、Compound），将Prepare挂到后端Make之后；原前后端配置名称和连接不变。

- 核对JetBrains官方[组合运行说明](https://www.jetbrains.com/help/idea/run-debug-multiple.html)、[前置任务序列化源码](https://github.com/JetBrains/intellij-community/blob/master/platform/execution-impl/src/com/intellij/execution/impl/RunConfigurationBeforeRunProvider.java)及[Compound源码](https://github.com/JetBrains/intellij-community/blob/master/platform/execution-impl/src/com/intellij/execution/compound/CompoundRunConfiguration.kt)。记录为检索时master，不声称是安装版本源码。
- 5项Node测试通过，包含原2项路径测试和3项Make→Prepare顺序、组合仅包含前后端、恢复按钮/有限任务映射；5个生成XML均由System.Xml解析通过。
- 实际执行与IDEA npm配置相同的prepare:local、restore:docker，检查/停止原后端/调整网关/恢复健康均成功。无新增业务记录，不需要再次部署应用镜像或修改DB。
- 没有控制IDEA GUI点击绿色按钮；已生成并核验项目运行配置，IDEA编译仍由其自身执行。原Docker系统已恢复，未留下本地前后端测试进程。

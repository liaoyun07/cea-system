# S4 最小部署与故障恢复

范围对应P04/P05/P06/P11；没有高可用、自动备份、TLS终止或旧库迁移保证。默认只监听127.0.0.1，不为演示开放公网。

## 从空环境启动

1. JDK21、Maven3.8.8–3.x构建新backend：运行`scripts/verify.ps1`。需要Docker执行隔离MySQL/Registry/K3s/MinIO测试，含最终可执行JAR启动测试。JAR位于platform-server/target，不使用旧工程JAR。
2. 创建专用空MySQL8库及该库账号。设置README中的BACKEND_DB_URL/USER/PASSWORD、BACKEND_USER/PASSWORD/NAMESPACES。不能指向web-platform库。Flyway执行V1–V9；从已运行的新后端升级须先排空活动执行，停止所有旧版本进程，再启动；不混跑版本、不自动repair。
3. 启动`java -jar platform-server/target/platform-server-0.1.0-SNAPSHOT.jar`。未配置账号/DB、连接失败或迁移失败必须定位并纠正；不关闭鉴权或跳过迁移。用未认证GET /api/namespaces/lab/flows确认401，用配置身份确认200，再按README保存和执行Log示例。
4. 若要运行外部任务，按[镜像/部署](../contracts/s4-image-deployment.md)、[Job](../contracts/s4-job-execution.md)、[通用任务](../contracts/s4-common-tasks.md)配置所需连接。无对应任务时不要求安装所有外部组件。运行Application前须准备Skopeo、可读写Registry、正确namespace的Kube凭据、Job槽、S3 bucket和应用/数据集目录。
5. 先执行一个产物上传/下游读取的小Flow，确认Pod、S3产物、TaskRun/Attempt均为真实结果，再运行研究任务。目录登记/只读候选检查不等于外部依赖连通性验收。

同进程运行API/Executor/Scheduler/Worker是当前最小部署。按README角色开关可分成独立Worker进程，所有进程共享新后端库和同版本代码。多Worker需提供一致的namespace连接配置；本阶段不建设动态配置分发。

## 凭据与最小开放面

- 平台API使用Basic和namespace/action范围；P03当前后置，HTTP Basic不等于传输加密。跨主机访问应另行配置加密通道，不能把当前回环测试写成公网安全验收。
- 数据库专用账号，不使用root。SQL任务另外配置只读业务账号，不共享平台元数据库身份。
- Registry认证来自外部auth文件；Kubernetes来自显式kubeconfig/context/namespace；S3和HTTP凭据来自外部文件。文件不入Git，不返回给任务镜像。
- 修改连接/账号配置后滚动前先停止接收新任务并排空，停机替换所有进程配置。S3/HTTP凭据文件在调用时读取；Kubernetes每次打开连接读取。没有自动轮换服务。
- 只开放后端回环监听、必要DB/Registry/Kubernetes/S3内网端口。Kubernetes Job无需回调后端或暴露Service；凭据Role限定在配置namespace，额外只有nodes list用于健康选址。

## 故障处理

- Worker停止/强杀：不要删除原Job；新Worker在租约过期后读取固定计划和Job，恢复同Attempt。Executor仍是运行状态唯一拥有者。
- MySQL短时不可用：提交可能失败；不确定是否已接受的提交沿用同Idempotency-Key重试。已接受运行保留；远程Job不因Worker丢租约自动新建。DB恢复后重新归并，不人工改状态为成功。
- HTTP POST结果未知：查看外部系统确认，再决定是否有意新提交；平台不会自动重发。SQL写入目前不支持。
- 取消/超时：Application等待Pod停止后才结束Attempt/Finally。Kubernetes不可达时停止无法确认，任务保持待回收，不伪造已停止。
- 产物存储中断：保留Job和同Attempt，恢复后补传；未发布结果中的部分S3对象不能被当作有效上游输出。
- 本批不覆盖节点永久丢失、手工强删Job/Pod、跨地域容灾、磁盘满和历史对象自动清理。Job及预约记录保留便于接管；不得把P10后置误解为可以无限堆积无运维管理。

实际测试证据见验证目录及当前进度；单机Docker中独立K3s/Registry是隔离集群验证，不是多地域真实云性能或容灾测试。

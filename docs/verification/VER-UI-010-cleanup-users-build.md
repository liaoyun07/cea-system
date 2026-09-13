# VER-UI-010 删除、人员与独立在线构建

日期：2026-09-13。基线cd905bd；本批提交号见Git历史。环境Windows/Docker Desktop D盘数据、JDK21.0.12.1、Spring Boot4.1.1、MySQL8、Node24、真实Registry2/K3s/BuildKit0.33.0-rootless。范围见[UI-10](../features/UI-10-cleanup-users-build.md)；状态：PASS，已部署CEA。下面保留初次失败及后续实际结果。

## 验证链与初次失败

- 定向MySQL删除3项通过；人员改密/角色/范围/启停/重启不覆盖1项通过。流程活动/修订保护、幂等重投、计划清除、Dataset契约引用/版本不可复用真实落库验证，不模拟成功。
- 真实BuildKit测试通过：用scratch+真实busybox/musl构建，RUN写文件，导入中心Registry，按需分发到目标Registry，再在隔离Docker引擎启动并读回`built-by-cea`。路径穿越、无Dockerfile、错误Dockerfile、只读身份、重复版本、大小拒绝、临时文件清理均覆盖；后续完整verify再覆盖并发和deadline。
- 初次定向测试的管理员缺少显式role（测试CLI覆盖整个配置数组），已修正测试配置；不增加“猜测第一个管理员”的兼容分支。
- BuildKit首次Docker Hub拉取EOF，使用真实Skopeo从同一官方仓库复制官方linux/amd64镜像后docker load，未关闭TLS或换非官方镜像。测试容器启动参数通过Docker CLI转换systempaths设置；测试archive复制由root拥有，清理限定本次UUID目录使用测试容器root，不改生产builder权限。
- 第一轮完整verify暴露CONNECT认证对象被Spring清除密码后复用导致401；IdentityDirectory改为每次返回独立UserDetails，机器外部配置仍为唯一源。第二轮EdgeAccess/Offloading认证回归通过。前两轮完整verify仍在同一卸载用例出现MySQL 1.5秒socket读取超时/commit后rollback失败，没有据此发布。
- 09:26:44卸载单测真实三位置及模型训练/执行通过；09:29:18构建→卸载两项组合通过；09:33:28 FedProx训练→构建→卸载三项组合通过。生产代码、socket阈值和失败断言均未放宽。仅给隔离测试driver增加失败时MySQL线程/等待诊断，不重试不明commit、不吞异常；尚不能仅凭定向通过断言原超时根因。
- 第一轮浏览器52/54通过；2个测试脚本问题为Dataset使用POST而真实接口为PUT，以及改密reset提交后没有等成功响应便验证旧密码。修正测试请求和等待，不放宽401断言。
- rootless组映射现场检查：daemon内部`--group=1000`会成为外层100999，不能与后端GID1000共享；改为内部`--group=0`后socket实际1000:1000/660。保持非root后端、无宿主Docker socket，发布时再以实际backend用户连接验证。

## 最终验证与发布

2026-09-13 09:47:47完整`scripts/verify.ps1` PASS：235项（runtime35、server199、实际JAR启动1），0失败/错误/跳过。ImageDistribution46项包含真实在线构建、并发409/deadline清理、FedAvg/FedProx、终端三位置/单步Q与故障接管。保留原socket阈值、执行断言和前两次失败记录；最终全量通过，不把先前超时原因宣称为已定位。

前端`npm test`45项、`format:check`、`build` PASS；真实浏览器第二轮54/54 PASS（3.2分钟，09:15前后完成），包括删除后历史快照图、用户/改密/权限及真实BuildKit构建登记。09:34再次单测/格式/构建通过。资源包`index-DeloJ7Ct.js`、`index-BzlRZk7-.css`。09:48:13格式化后的OpenAPI再次3项ContractTest PASS；scaffold为8模块/104个Java文件/32功能ID/527本地链接。独立测试创建的容器/数据与CEA无关，结束清理fixture，不删除CEA对象。

09:52:38追加`deletionRacesWithSubmissionsAndContractsWithoutDanglingReferences`通过：Flow删除对任务提交、Dataset删除对契约登记各5轮并发，两方只能一方成功，不留下已删对象的新引用。仅补测试断言，生产代码与已部署JAR不变；它不计入此前235项全量数字。收尾scaffold再次PASS：104个Java文件、32功能ID、529本地链接；`git diff --check`通过。

发布前只读快照：12个CEA容器、2个Flow、6个ApplicationVersion、2个DatasetVersion、4个Execution、38个TaskRun、27个Attempt。09:48:13备份专用数据库并保留前后端`ui10-rollback-20260913-094813`镜像；确认无活动任务。09:49:44发布完成：只更新backend/frontend，新增builder、专用socket/cache与构建网络；V21–V24共24项迁移成功。Dockerfile依赖仓库有重试后成功，未关闭TLS。

09:50:14实际18080管理员页、个人中心390px、在线构建入口视觉/无页面错误复核PASS。首次只读脚本在表格数据加载前检查管理员失败，改为等待管理员单元格；没有修改线上账号或页面代码。实际backend UID通过共享UNIX socket执行真实COPY构建并导出Docker镜像归档，未向应用目录/Registry登记、未创建工作负载。仅清理本次唯一临时目录，构建缓存保留。数据前后对照PASS：原Flow、应用/数据集、Execution/TaskRun/Attempt、http-server部署UID/spec和全部原卷不变；其他10容器ID/StartedAt/镜像不变。现为13个CEA服务。私有备份、快照、构建归档与截图在忽略目录`.local/evidence`，不提交真实凭据。

不属于本次验收：任意不可信多租户构建、私有基础镜像认证、多架构、持久构建历史、物理删除/磁盘GC、SSO/复杂RBAC、数据处理速率/DQN新增、旧系统切换。没有为正式性能指标造数。

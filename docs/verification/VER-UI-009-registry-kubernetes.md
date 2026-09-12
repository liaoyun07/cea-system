# VER-UI-009 Registry / Kubernetes 管理

状态：PASS，已部署CEA。源码基线fd1d100，加本批UI-09提交（以Git历史为准）。测试使用独立容器，不删除CEA业务数据。

已执行：Java21 compile/test-compile通过；45个前端单元测试、格式检查、Vite生产构建通过。2026-09-13 04:49定向verify通过（5项真实集成、3项契约与1项打包启动）；05:09完整浏览器50项通过，覆盖新增管理的真实CRUD、Pod关联、引用保护和原功能回归。窄屏详情排版随后优化，发布前再复测。

2026-09-13 05:24:07：最终完整`scripts/verify.ps1` PASS，230项（35 runtime、194 server、1打包启动），无失败、无跳过，耗时13分13秒；其中45项真实Registry/Kubernetes集成全部通过。实际命令使用JDK `C:/Users/liaoy/.jdks/ms-21.0.12.1`。结构检查：8模块、99生产Java、32功能ID、510本地链接。

最终结果（2026-09-13 06:21）：源tag与digest两种契约候选均覆盖；06:18:11完整`scripts/verify.ps1`再次PASS，230项无失败/跳过，耗时13分05秒。最终前端45项Node、格式、构建及50项浏览器通过（05:28；此后前端源码未变，后端库存补丁另经定向/完整回归及实际部署页面复核）。06:19只更新最终后端，前端只reload Nginx；此前已部署前端、4个Registry删除开关与4个集群管理RBAC，无新增DB migration。实际18080完整复核PASS：中心仓库5个镜像条目，edge-a/b/c各2个，源标签解析、目标摘要直接查询与库存逐项一致；包含无标签、无分发历史的副本，不是11种不同镜像内容。

发布前后JSON语义比对：原2个Flow及修订、6个应用版本、4条Execution、38个TaskRun、27个Attempt、cloud/http-server部署及全部数据卷挂载不变，MySQL、MinIO、4个算法集群容器ID不变。默认执行Namespace仍为cea-lab；4集群Namespace/Service创建权限生效，读取Secret仍被RBAC拒绝。http-server原Pod未替换，最终健康接口返回200/status=ok。未创建/删除CEA业务资源、未重跑训练；实际页面也复核既有联邦Metrics、拓扑、节点用量和管理页。

最终本地证据（不提交凭据/数据）：`.local/evidence/ui09-verify-source-tag.log`、`ui09-e2e-release.log`、`ui09-deploy-source-tag.log`、`ui09-live-verify-source-tag.log`、`ui09-live-browser-source-tag.log`；截图及逐仓库结果在`.local/cea/browser/`。业务前后快照在`.local/evidence/ui09-live-before.json`与`ui09-live-after.json`。四份数据库备份`ui09-mysql-*.sql`及对应回退镜像已保留；回退不自动执行，使用目录删除后不能直接用不识别deleted的旧后端恢复活动目录含义。

最终文档收尾结构检查PASS：8模块、99生产Java、32功能ID、512本地链接；git diff检查通过。共有77个HTTP操作、88个显式公开record映射；本批增加6类、13操作、11映射和V20一列，无新表/SPI或通用工作流语义变更。

05:28最终前端50项浏览器再次通过（窄屏排版已包含），45项Node/格式/构建通过。05:30首次发布前后端及4个Registry并更新4集群ClusterRole；V20成功，未删除任何应用版本。发布前数据库备份约158KiB，两份文件位于`.local/evidence/ui09-mysql-20260913-052850.sql`和`ui09-mysql-20260913-052947.sql`，保留对应时间戳的backend/frontend回退镜像。首次RBAC补丁因PowerShell 5数组序列化为对象而被API拒绝，修正发布脚本后重试，未强制覆盖对象；实际页面测试的导航按钮/下拉框同名定位也已修正。

发布后边界复核发现：没有标签且没有分发历史的已有边缘副本可按digest查询，但库存列表遗漏。不能据空标签/空历史判为空库存。修正为使用同名应用契约已知digest查询`namespace/applicationId`目标路径，必须现场验证manifest存在；同样纳入索引引用检查，不增加历史记录、数据库列或兼容分支。新增隔离断言先删除测试副本的历史记录再验证真实库存，并在部署复核中将已知digest的直接查询与列表逐一比较。最终结果见上文。

库存修正还覆盖“目录移除后仍能找到未清理镜像”：读取V20已保留契约中的image候选，删除标记仍阻止执行/复用。为合并该相同边界的断言，05:40主动终止了一轮仅隔离测试的Surefire JVM，未停止CEA服务；该轮中断不记为PASS。最终完整回归以之后完成记录为准。

05:56:34带保留契约候选的完整230项回归通过，05:57仅更新后端；进一步检查实际契约发现5个联邦应用使用`:deploy-v1`标签，固定摘要分支仍未覆盖它们。原部署检查也只为固定摘要生成候选，因此其PASS不能证明这些副本已展示。增加已授权源Registry标签解析，并把同样的tag/无历史/目录移除场景加入真实集成测试；06:03:42定向4项加1项打包启动通过。实际页面复核现在先从源仓库标签取得digest，再与目标直接查询和库存逐项比较，不再跳过tag契约。最后一轮全量与部署已通过，见上文最终结果。

失败与修正：最初新增Flow引用测试遗漏timeout/command、Registry对无标签仓库的tags/list返回404，均已据真实行为修正；首轮全量的两项既有测试发生MySQL连接回滚失败及等待Pod超时，未修改其超时/断言，定向复测通过。首轮浏览器48/50通过，新增测试的下拉框定位方式及Alpine不含httpd命令修正后50/50通过。不把预期失败场景的ERROR日志当作成功部署证据。

发布前只读基线：12个CEA容器、FedAvg r5/FedProx r3、6个应用版本、4条历史执行（2 SUCCESS、1 FAILED、1 KILLED）、38个TaskRun、27个Attempt及cloud/http-server部署。无进行中的执行；不重跑训练。

用户已授权：测试通过后发布CEA前后端，启用4个Registry的删除开关并更新4个集群管理RBAC。保留数据库、数据卷、所有既有Flow/Execution/Application/Deployment；算法集群不重启。

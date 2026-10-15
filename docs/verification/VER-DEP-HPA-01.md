# VER-DEP-HPA-01

2026-10-15，已部署并验收。源码基于51c5cab，本批提交以Git记录为准。验收原生HPA配置与执行，不声明部署效率提升。

四集群Metrics Server可用、原HPA均为0。授权后仅向cea-observe-nodes ClusterRole增加HPA get/list/create/update/delete，逐集群前后规则精确比较和账号权限检查通过。前端71单测、构建、2项专项浏览器交互通过。

JDK21完整verify实际执行20分09秒，业务用例（含65项真实Registry/K3s集成）通过，ContractTest路由检查因启动测试时新OpenAPI尚未同步而失败1项。文档补齐后，以同一业务代码执行 `mvn verify -Dtest=ContractTest -Dsurefire.failIfNoSpecifiedTests=false`，契约3项及打包启动验证通过（28秒）；最终Surefire/Failsafe报告合计314项、0失败/错误/跳过。没有把首次完整命令写成成功。

仅重建并重启backend/frontend，均healthy；保留 `cea/backend:before-hpa-20261015` 和 `cea/frontend:before-hpa-20261015`。实际浏览器HPA编辑、指标、禁用手动副本、桌面/窄屏截图通过。临时测试部署为edge-a/cea-lab/verify-hpa-20261015，使用原edge-bearing/ep01-v1镜像，CPU request/limit100m、内存16Mi/64Mi，1..2副本；CPU100%时已自动扩为2个就绪副本。

真实控制器扩容时间23:29:58，23:30:29确认2个就绪副本；负载结束后保持原生缩容稳定窗口，23:36:58自动缩为1，23:37:34确认1个就绪副本。开启HPA时提交replicas=0的配置编辑仍保留实际副本（分别在2副本和1副本验证）；关闭HPA保留1副本。临时将测试HPA标为外部所有时，读取editable=false，编辑/删除均409，恢复后配置不变；不触碰旧资源。

最终finish结果PASS：测试HPA、Deployment及其Pod已清理；四集群所有旧Deployment规格/UID、原HPA列表均与发布前一致，29个非目标服务身份及启动时间不变。测试操作历史保留。结构与链接检查通过。无数据库表/字段、通用工作流语义或其他基础设施变更。

本地证据 `.local/cea/hpa/`，工具 `deploy/cea/verify-hpa.mjs`：before备份权限/Deployment规格/HPA/服务身份；permissions只追加授权规则；start新建独立低限额部署；observe记录控制器真实状态；ui验证页面；finish验证并删除本次测试部署。不能重复before覆盖原始证据。

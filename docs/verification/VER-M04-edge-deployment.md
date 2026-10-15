# M04 小中大边缘服务部署验证

## 2026-10-16：小中大公共服务九次实测

用户要求使用公共服务覆盖不同体量，而非自定义算法服务。预先选择Nginx、Prometheus、Jenkins并冻结配置，未按照结果调整资源、添加初始化延迟或筛掉慢样本。9次CREATE全部部署成功、平台计时有效、HTTP验证通过；其中8次≤30秒，Jenkins首次31.802秒，故本组不能宣称全部公共服务均在30秒内完成。脚本summary的PASS表示实验完成/响应与旧资源校验通过，不表示9个样本全部达到30秒。

| 档位/服务 | 实际版本 | 平台镜像层总大小 | 本批首次CREATE | 缓存后1 | 缓存后2 |
|---|---|---:|---:|---:|---:|
| 小 Nginx非特权版 | 1.28.2 | 52.77 MiB | 3.016 s（已有上一批层缓存） | 1.918 s | 2.035 s |
| 中 Prometheus | 3.5.0 | 299.63 MiB | 8.304 s | 1.476 s | 1.546 s |
| 大 Jenkins LTS/JDK21 | 2.580.1 | 432.42 MiB | 31.802 s | 28.345 s | 28.518 s |

统一edge-a/cea-lab、单副本、CPU request100m/limit1核、内存request128Mi/limit1Gi；保留上游默认命令和配置，无PVC/HPA/Service/Ingress。各次均新Pod/空应用数据目录，只有镜像缓存复用，不是已初始化数据目录重启。Nginx `GET /:8080`验证欢迎页；Prometheus `GET /-/ready:9090`并实际查询1+1=2；Jenkins `GET /login:8080`验证Jenkins页面，终点为初始解锁界面可用，不包含人工安装插件、创建管理员、构建流水线。三种探针沿平台默认1秒周期，无人为启动等待。

Prometheus和Jenkins首次节点可见层命中均为0字节，实际拉取事件4.565/2.983秒；后两次均already present。Nginx首次新仓库引用拉取39ms，所需层全部来自上一批缓存，不能称冷启动。未清缓存，零content命中也不等于所有快照/系统页缓存为空。平台仓库manifest层总字节分别55331328/314181120/453422592，非Docker Hub下载压缩量。中心仓库上传注册在计时前，计时仍为平台开始准备/分发镜像到确认Deployment全部副本Ready/Available。Docker Desktop共享宿主、本地Registry，不代表公网下载。

使用[公共服务脚本](../../examples/deployment-benchmark/public-services.mjs)，批次`public-20261016`，源码起点5a69e0e。本地`.local/cea/public-services/public-20261016/`保存plan（源摘要及入口）、images、results（原平台操作/Pod/Event）、before/after/summary和页面截图。平台镜像manifest摘要：Nginx42a5059267af00379ff7fb52d0030db1b8c3014ff8bb7419de672a46413e95db；Prometheus9d604eaf26ef02ec7a9bff65e2e62fe4aba58d1365e167f750478d8488a8f876；Jenkins8e881024eb6a5055d10c880d8b0143a238716b8f389386d835b06a7620ccaaf5。

每服务前两份临时Deployment/Pod正常删除，最后一份保留为`public-nginx-public-20261016`、`public-prometheus-public-20261016`、`public-jenkins-public-20261016`，详情保留三次操作历史。原四集群Deployment UID/规格与31个原CEA容器ID/启动时间逐项一致。没有生产代码、数据库结构、权限或前后端发布；不重跑无关Java/前端回归。Node语法、实际部署HTTP验证、页面列表/详情及结构检查通过。上游选择和探针依据见[示例说明](../../examples/deployment-benchmark/README.md)。

页面列表最终显示2.04/1.55/28.52秒，Jenkins详情可打开，未出现浏览器脚本错误。本批三个临时上传tar归档合计393081856字节已删除；原始镜像、仓库内容和所有测量记录保留，归档可从镜像重新导出。

## 2026-10-16：常见服务 Nginx 实测

用户要求使用常见服务而非自定义服务测量。使用 Nginx 官方维护的 `nginxinc/nginx-unprivileged:1.28-alpine`，实际版本1.28.2，默认入口/命令/配置不变；注册为 `common-nginx/nginx128-20261016`，通过现有部署API在edge-a/cea-lab单副本CREATE。CPU request100m/limit1核，内存request32Mi/limit128Mi，HTTP `/` 8080就绪探针，无HPA、PVC或对外Service。未改平台代码、RBAC、计时或现有数据库。

| 样本 | 平台部署耗时 | 节点镜像情况 | HTTP欢迎页 |
|---|---:|---|---|
| 首次 | 2.944 s | 拉取事件727ms；此前所需层内容命中0字节 | 通过 |
| 缓存后1 | 2.897 s | already present | 通过 |
| 缓存后2 | 2.772 s | already present | 通过 |

耗时沿用开始准备镜像到后端观察全部副本Ready/Available；不包含事先从Docker Hub下载及上传注册镜像。中心仓库先导入，首次部署再通过平台分发至边缘仓库。层总字节55331328（52.77MiB），单Docker Desktop宿主本地仓库，不代表公网拉取。仅三次结果，不推断稳定性能。原 `nginx:1.28-alpine` 在相同drop ALL能力的本地配置预检中因chown权限失败，故选择厂商非特权版本，未为实验提升权限；MySQL所需TCP/exec就绪探针未在当前表单暴露，本批没有测试MySQL。

来源：[Nginx官方非特权镜像](https://github.com/nginx/docker-nginx-unprivileged)。源索引摘要7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8，实际导入manifest摘要42a5059267af00379ff7fb52d0030db1b8c3014ff8bb7419de672a46413e95db；源码5a69e0e。原始证据 `.local/cea/nginx-deploy-20261016/` 包含plan、结果、Pod/Event、前后快照。前两份测试Deployment已正常删除并重建，保留最后一份 `common-nginx-20261016` 及三次操作历史供前端查看。四集群原Deployment配置/UID及20个CEA Compose服务身份/启动时间保持，无重启。只做实测与文档记录，没有重跑业务回归或发布平台。

实际18080页面验证：edge-a列表显示 `common-nginx-20261016`、1/1副本、成功2.77秒，详情可打开并截图；脚本首次因本地Playwright相对路径多一层而未运行，修正路径后只读页面验证通过，未重跑部署。结构/链接检查通过。本段验证记录随同日公共服务三档批次提交，保留其他未提交改动。

2026-09-14。状态：当前CEA条件下12/12测量样本PASS，3个展示部署PASS，已在18080复核；不是完整冷缓存或物理WAN验收。代码起点main `b0201e486c71e55c027e8a414d93f3d66b9fac75`，本批只新增独立示例/测试与文档，不修改Java、DB、API、部署计时或执行主链。

## 冻结条件

范围、服务、请求与算法数据边界见[示例规格](../../examples/deployment-benchmark/README.md)。同一CEA edge-a、单副本、HTTP就绪、依次CREATE；每服务首次部署1次和热缓存3次，完整记录全部样本。模型包含在镜像内，初始化与预热计入部署等待。单Docker Desktop宿主，不是物理多云。第一轮仅叫首次新服务部署，不预设无基础层缓存。

三份模型服务镜像在实际部署前均完成8项测试，共24项PASS：HTTP健康、路由、类型、损坏输入、尺寸限制、实际结果、领域输入限制和模型/配置启动失败。参考请求从原数据和原算法生成，未重新训练模型或选择阈值。第一次构建被根目录.dockerignore排除示例源码而失败，新增该Dockerfile专用最小上下文白名单后重新构建通过；未改根目录忽略规则。

平台没有代码改动，因此无需构建/发布前后端，也未重跑Maven/前端全量回归。下述均为原API和新示例的实际结果，不把历史Maven通过数当成本批重跑。

## 实际结果

证据目录：仓库`.local/cea/met04/met04-v1/cea-20260914144439/`。开始前冻结plan，22:45–22:52进行实际部署，22:53:05完成18080页面核验（Asia/Shanghai）。原始trials/summary/images/plan/before/after/display/browser JSON及截图保留本地。

| 服务 | Registry manifest层总字节 | 层总大小MiB | 首次新服务部署s | 三次热缓存部署s | 热缓存平均s | 热缓存最大s | 测量样本 |
|---|---|---|---|---|---|---|---|
| 振动统计small | 129038336 | 123.06 | 2.190 | 1.385 / 1.595 / 1.943 | 1.641 | 1.943 | 4/4通过 |
| 轴承诊断medium | 412834304 | 393.71 | 4.372 | 1.967 / 1.891 / 1.853 | 1.904 | 1.967 | 4/4通过 |
| 表面缺陷large | 1263643136 | 1205.10 | 12.318 | 2.558 / 3.698 / 3.880 | 3.379 | 3.880 | 4/4通过 |

全部12个样本为单副本CREATE、SUCCEEDED、有效durationMs且业务数值校验通过，无失败、无缺失，不排除慢样本。上表层大小取实际Registry manifest的各layer.size之和，不等于本次网络传输量；对应Docker save归档分别45471232、133169664、396137472字节，不能混用这两种体积。所有warm Pod事件明确image already present，首次事件分别报告pull约91ms/1.35s/5.211s；pull事件不是完整部署耗时。

节点为`cea-edge-a-1`，K3s `v1.30.6-k3s1`，外层3 CPU/2 GiB限额；服务数值计算线程1。节点及平台、Registry均位于同一个Docker Desktop宿主，未配置WAN延迟/限速；现有服务继续运行，平台测试期间没有活动Flow。每次仅一个测试部署，记录后沿原删除接口清理该新Deployment并等待Pod退出，再开始下一次；没有改启动计时或通过强删加速就绪。示例Python PID1的正常Kubernetes终止可能等待宽限期，该清理发生在测量后，不计入部署时间，也不能作为停止耗时达标证据。

首次创建不意味着完整冷启动：已有基础镜像/解包快照可能复用；保存的content摘要交集没有覆盖所有快照。即使small的交集为0，也不能宣称它没有任何缓存。完整无基础层缓存隔离环境已询问但截至本记录未获得确认，未创建新K3s/Registry/后端/数据库，未清除现有缓存。

## 发布和可见结果

通过原上传接口注册3个应用版本：`met04-small/met04-v1`、`met04-medium/met04-v1`、`met04-large/met04-v1`。12次测量后又创建3个展示部署，全部就绪且业务验证通过；这三次与测量样本分开保存，不混入上表平均值。

| edge-a保留的部署 | 最新页面耗时 | 历史 |
|---|---|---|
| met04-small-20260914144439 | 1.83 s（原值1830ms） | 4次测试＋1次展示，共5条 |
| met04-medium-20260914144439 | 2.14 s（原值2136ms） | 4次测试＋1次展示，共5条 |
| met04-large-20260914144439 | 3.18 s（原值3176ms） | 4次测试＋1次展示，共5条 |

实际18080“应用部署→edge-a”三个名称、成功状态、原API耗时及每个详情的5条操作历史通过只读浏览器检查；1440px及650px截图已复核，窄屏表格保留横向滚动。业务HTTP请求经Pod内客户端发送，未另建公网Service/Ingress；就绪和实际算法响应已检验，不声称从互联网访问成功。

测量后删除的仅本批12个临时Deployment及其Pod；数据库操作历史和镜像仍保留，可从三份同名展示部署的详情回看。未删除原应用或工作负载。前后快照核对：19个CEA常驻容器ID/镜像/启动时间、2个Flow目录、134个Execution、13个策略目录、2个Dataset和124条卸载样本保持一致。没有重启前后端或其余基础服务，没有迁移旧数据。

## 验证边界

- 24项镜像内测试、三个独立原算法对照、12次测量＋3次展示业务请求、18080列表/历史/桌面/窄屏检查PASS。
- Node脚本语法及文档结构/链接、`git diff --check`通过；生产Java索引和模块依赖不变。首次验证文件名误作新计量功能编号，按既有M04审查项命名后结构检查通过，不新增空功能编号。
- Registry镜像摘要分别为small `sha256:e779e0ea263d837e67c75964ea0f67c89103af80d26dd0b1a300e4e9116a01b0`、medium `sha256:4f465a0184adccba98e1dbf311ccecb887475d1c7c1ae24b42d46c1b59dbc4c8`、large `sha256:c892fa162c769f121a17a6a9a5cd94c370360b43660a35e5398ad3b785dc07e4`，身份来自真实OCI内容协议，不新增领域hash字段。
- 不以三次热样本计算有统计代表性的P95，不从示例推广为任何镜像/任意网络均≤30秒。M04已有明确条件的达标证据；完整冷缓存及正式环境代表性仍待验证。M01/M02/M03和相对提升指标未在本批测试。

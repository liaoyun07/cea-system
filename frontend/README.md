# CEA 流任务工作台

UI-08a按用户要求直接删除运行资源的容器用量标签和相关前端请求；保留节点CPU/内存、Service和Namespace，不迁移到其他页面，也不替换为提示。发布与验证状态见[进度](../docs/04-progress.md)。UI-08前后端基线已于2026-09-13发布，下面的“尚未发布”指原实现验收阶段。

UI-08已实现并验证：单镜像Docker save归档上传、按需分发历史、Deployment配置回读/CAS编辑/手动扩缩容/就绪耗时，以及Metrics API近期CPU/内存。45项Node、47项真实浏览器通过。需要配套后端、V18/V19及配置/RBAC/采集器；尚未发布CEA。日志、数据文件上传、HPA和历史监控不在本批。边界见[UI-08协议](../docs/contracts/ui08-deployment-operations.md)，结果见[验收记录](../docs/verification/VER-UI-008-core-deployment-operations.md)。

UI-07增加运行总览、运行资源（Node/Service/配置的Kubernetes Namespace）和执行输出中的任务产物JSON预览。总览统计提交时间窗口内执行的当前状态；资源为只读查询，容量不代表利用率；JSON沿用256KiB上限，其它文件只显示URI。运行资源需要配套后端及受限RBAC。实测/发布状态见[UI-07验证](../docs/verification/VER-UI-007-readonly-inspection.md)。

独立Vue 3/Vite前端，属于cea-system仓库但单独构建，不是Maven模块。参考Kestra的侧栏、列表、源代码编辑、保存/执行分离和执行标签页，中文界面，无模拟业务数据，不修改旧AMIS。

页面文案保持简洁：不放常驻教学/架构说明，也不将其搬进展开帮助或悬浮提示。保留字段标签、真实数据、空状态、错误、确认和操作结果；详细语义在本文及协议文档维护。

## 本地启动

先按[后端说明](../README.md)配置并启动新后端，默认`127.0.0.1:18085`，必须使用新数据库。Node.js 22.12+（本次验证24.19.0）：

```powershell
cd D:\Project\IDEAProject\gateway\backend\frontend
npm ci
npm run dev
```

打开`http://127.0.0.1:18100`，填写授权命名空间、账号和当前密码。UI-10起人员账号由后端DB管理，外部配置仅首次初始化；前端没有默认密码或身份数据库。后端未启动时明确失败，不伪造列表。ADMIN可用“用户管理”，所有人员可用“个人中心”改密；改密后退出重新登录。

默认代理`/api`到`http://127.0.0.1:18085`。端口不同时先设置`$env:BACKEND_URL='http://127.0.0.1:你的端口'`，或参照`.env.example`创建`.env.local`。代理目标只由管理员配置；不要把凭据放入VITE_*或提交Git。

## 第一次操作

执行详情的Metrics页签按任务、JSON产物、指标名查看真实数值。每页20个实例、单指标图和原值明细；轮次/item来自实际TaskRun。UI-06a增加图表右上角柱状/折线切换，默认柱状；共用原始数据、坐标和顺序，缺失断线、单值显示点，不插值、不新增请求。FedAvg/FedProx现有metrics.json可直接读取，不需重建算法镜像。训练epoch采样和数据处理速率尚未实现；无产物或读取失败不补值。部署需要匹配UI-06后端接口，详见[边界](../docs/features/UI-06-execution-metrics.md)；UI-06a发布状态见[验证](../docs/verification/VER-UI-006a-chart-switch.md)。

执行页新增“拓扑”：按固定执行修订只读显示依赖，点击节点查看TaskRun输出、时间和Attempt；展开Repeat切换轮次、展开Loop切换实际item。根生命周期分组独立，失败/取消/跳过状态直接来自后端。耗时是实例的结束减开始，不是算法速率。详见[UI-05边界](../docs/features/UI-05-execution-inspection.md)。

连接 → 新建流程 → 填写流程ID → 创建空流程 → 添加任务 → 点击任务块配置 → 校验 → 保存修订 → 执行 → 填写输入/预览 → 启动执行 → 查看概览/任务实例/日志/输出。也可切换“源代码”粘贴YAML或插入Log示例。

默认进入“可视化编排”：左侧任务分组，右侧单个配置面板；“并排编辑”同时显示源码（较窄屏幕上下排列）。流程设置中显式定义inputs/variables/outputs；Application选择已登记版本，参数可引用流程输入、变量、上游输出、当前Loop item或固定值。不自动生成Flow Input。Application的命令、候选集群/终端位置和超时须明确配置；应用默认值仅提示，未指定绑定时由原后端处理。

可添加顺序/并行/DAG/If/Repeat/Loop及错误/清理/后处理任务，折叠、上下移动或移组；DAG依赖独立于定义顺序。移动后仍需服务端校验作用域，删除被引用任务会拒绝。任务ID在新增时填写；已有ID改名和本次未覆盖字段在YAML中修改。修订历史可并排比较保存源码，回退会创建新修订，未保存草稿时禁止回退。

已登记的FedAvg/FedProx也能从列表编辑/运行，不需要专用前端接口。镜像、集群、存储、数据集和应用契约仍须按[算法运行说明](../algorithms/federated/README.md)准备。本批浏览器测试运行Log/Sleep，不是从页面完成物理多云训练的验收。

## 应用与边缘管理（UI-03）

侧栏增加应用与镜像、应用部署、集群资源、数据集、边缘网关、终端设备、边缘处理策略和卸载观测。全部使用新后端现有API，不导入旧数据。

推荐登记顺序：集群 → 数据集版本/位置 → 应用版本/契约 → 流程或常驻部署。应用参数声明包括类型、必填、默认值、允许值或DatasetRule；原版本只能查看，“基于此版本新建”用于修改。镜像准备操作返回实际目标digest镜像，不代表容器已运行，也不是持久分发历史。

网关需先配置专用CONNECT账号，再登记边缘集群/账号归属，之后登记终端。页面展示真实lastSeenAt，不推断在线。策略使用同一No-code/YAML编辑器，保存到edge策略API，expectedRevision冲突保留草稿；事件路由不可改派。策略Flow不出现在普通流程列表。

应用部署只创建新名称、查询实际副本/条件及带resourceVersion删除。当前后端GET不回传原parameters/command，因此暂不提供可能清空这些配置的编辑、启停或缩放。目录enabled只控制准入，不是健康状态；登记集群不自动创建连接配置。完整迁移矩阵见[UI-03范围](../docs/features/UI-03-management.md)。

## 重要语义

- YAML是唯一编辑源；No-code按Document节点路径修改，表单结构来自后端Schema。保留未改字段和注释，但序列化可能调整空白/折行。非法YAML、重复键、别名、超大整数不会被表单静默替换；修正源码后恢复。不是完整Kestra/Monaco，不提供任意画线或第二份画布定义。
- 保存用expectedRevision；409保留草稿，可导出后重新读取最新修订并手工合并，不强制覆盖。
- 保存且无修改才能运行，提交固定修订，不静默运行latest。六种输入类型来自Flow.inputs，OBJECT/ARRAY填写JSON。未勾选“提供”的字段省略，由后端应用默认值/必填校验；false/0/空字符串不丢失。客户端整数限定JavaScript安全整数范围。
- 提交结果未知时冻结请求及Idempotency-Key，“原请求重试”不换键。离开/刷新会告警，但不持久化请求，请先确认执行记录。
- 每2秒串行轮询，离开详情停止；错误暂停，手动刷新恢复。日志按afterId每页100条增量读取，内存最多显示最近1000条。
- 主终态后继续刷新afterExecution；后处理失败不改主结果。取消展示实际状态，不把202当KILLED。
- 凭据只在页面内存，断开清空，刷新需重连。HTTP Basic不提供传输加密，不能直接明文暴露公网。

## 构建与部署

```powershell
npm run build
npm run preview
```

`dist/`是静态产物，preview仅用于本地检查，不是生产服务器。部署时由静态服务器同源代理`/api/`。已有Nginx站点可参考以下片段，由管理员替换路径；不是自动部署：

```nginx
location / {
    root /srv/cea/frontend/dist;
    try_files $uri $uri/ /index.html;
}
location /api/ {
    proxy_pass http://127.0.0.1:18085;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
}
```

非本机访问需配置HTTPS和适当访问控制。无需放宽后端CORS，也不向浏览器暴露数据库/Kubernetes凭据。

## 边缘处理记录

“边缘与终端 → 边缘处理记录”使用受权`GET edge/processing-records`，按策略/状态服务端筛选分页；查看可信来源、原运行修订、状态和时间。“详情与结果”复用原执行详情，返回保留筛选/页码。来源边缘不等于实际任务位置，没有接入回执时不推测。需本批新后端，发布状态见[EP-02验收](../docs/verification/VER-EP-002-processing-records.md)。

## 验证

```powershell
npm test
npm run format:check
npm run build
npx playwright install chromium
$env:CEA_JAVA_HOME='你的 JDK 21 目录'
npm run test:e2e
```

E2E要求Docker可用、已构建后端JAR，以及本地测试镜像mysql:8.0、registry:2、quay.io/skopeo/stable:v1.20.0、rancher/k3s:v1.30.6-k3s1、rancher/mirrored-pause:3.6、rancher/mirrored-metrics-server:v0.7.2、alpine:latest及quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z。自动创建临时MySQL、Registry、Skopeo、K3s、MinIO、随机账号/端口、新JAR进程和静态预览；测试结束清理本次容器、网络和临时配置。不接业务库、不启动/停止IDEA或CEA服务。临时K3s用于实际上传、分发、Deployment编辑/就绪/缩放/删除、近期用量及JSON产物读取验收。失败trace位于test-results，后端日志与截图位于.local/evidence，均不提交Git。Java全量测试仍用根scripts/verify.ps1。

UI-10 E2E还会创建独立`moby/buildkit:v0.33.0-rootless`测试容器，使用真实构建及既有Registry导入；缺少镜像时需可访问官方镜像源。它不会使用或重启CEA的builder。

EP-02回归将浏览器基础设施同步到FILE-01：从`deploy/file-helper`构建独立测试助手镜像（基础镜像python:3.11-slim），导入临时K3s；临时MinIO加入测试网络，使用stores/outputs及Pod可达transfer-endpoint。结束仅删除本次容器/网络/助手镜像，不改CEA存储或权限。

UI-09已有Registry库存/详情/受保护删除、Service与受管Kubernetes Namespace管理；UI-10补两角色账号、个人中心、删除入口和ZIP/Dockerfile在线构建，实际验证/发布状态见[进度](../docs/04-progress.md)。仍无任意Node管理、数据文件上传、历史资源监控、跨执行指标趋势、数据处理速率、全局产物浏览下载或旧数据迁移。UI-08提供镜像tar上传和持久按需分发历史；UI-06提供已声明JSON产物的指标图和明细。No-code中的目录仍只读选择，登记在专属管理页完成；没有把Pod stdout伪装为平台日志。详细边界见[UI协议](../docs/contracts/ui-console.md)及[UI-10](../docs/contracts/ui10-cleanup-users-build.md)。

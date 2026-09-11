# CEA 流任务工作台

独立Vue 3/Vite前端，属于cea-system仓库但单独构建，不是Maven模块。参考Kestra的侧栏、列表、源代码编辑、保存/执行分离和执行标签页，中文界面，无模拟业务数据，不修改旧AMIS。

页面文案保持简洁：不放常驻教学/架构说明，也不将其搬进展开帮助或悬浮提示。保留字段标签、真实数据、空状态、错误、确认和操作结果；详细语义在本文及协议文档维护。

## 本地启动

先按[后端说明](../README.md)配置并启动新后端，默认`127.0.0.1:18085`，必须使用新数据库。Node.js 22.12+（本次验证24.19.0）：

```powershell
cd D:\Project\IDEAProject\gateway\backend\frontend
npm ci
npm run dev
```

打开`http://127.0.0.1:18100`，填写后端配置中的命名空间、账号和密码。前端没有默认密码或用户数据库。后端未启动时连接会明确失败，不伪造列表。

默认代理`/api`到`http://127.0.0.1:18085`。端口不同时先设置`$env:BACKEND_URL='http://127.0.0.1:你的端口'`，或参照`.env.example`创建`.env.local`。代理目标只由管理员配置；不要把凭据放入VITE_*或提交Git。

## 第一次操作

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

## 验证

```powershell
npm test
npm run format:check
npm run build
npx playwright install chromium
$env:CEA_JAVA_HOME='你的 JDK 21 目录'
npm run test:e2e
```

E2E要求Docker可用、已构建后端JAR，以及本地测试镜像mysql:8.0、registry:2、quay.io/skopeo/stable:v1.20.0、rancher/k3s:v1.30.6-k3s1、rancher/mirrored-pause:3.6和alpine:latest。自动创建临时MySQL、Registry、Skopeo、K3s、随机账号/端口、新JAR进程和静态预览；测试结束清理本次容器、网络和临时配置。不接业务库、不启动/停止IDEA或CEA服务。临时K3s仅用于浏览器实际分发/创建/就绪/删除验收。失败trace位于test-results，后端日志与截图位于.local/evidence，均不提交Git。Java全量测试仍用根scripts/verify.ps1。

尚无账号管理、Node/Service/Namespace完整管理、镜像tar上传/构建、持久分发历史、指标曲线、数据处理速率、产物浏览下载或旧数据迁移。No-code中的目录仍只读选择，登记在专属管理页完成；没有把Pod stdout伪装为平台日志。详细边界见[UI协议](../docs/contracts/ui-console.md)。

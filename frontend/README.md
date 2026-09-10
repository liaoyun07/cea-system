# CEA 流任务工作台

独立Vue 3/Vite前端，属于cea-system仓库但单独构建，不是Maven模块。参考Kestra的侧栏、列表、源代码编辑、保存/执行分离和执行标签页，中文界面，无模拟业务数据，不修改旧AMIS。

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

连接 → 新建流程 → 填写流程ID → 插入Log示例（只是草稿）→ 校验 → 保存修订 → 执行 → 填写输入/预览 → 启动执行 → 查看概览/任务实例/日志/输出。

已登记的FedAvg/FedProx也能从列表编辑/运行，不需要专用前端接口。镜像、集群、存储、数据集和应用契约仍须按[算法运行说明](../algorithms/federated/README.md)准备。本批浏览器测试运行Log/Sleep，不是从页面完成物理多云训练的验收。

## 重要语义

- YAML是唯一编辑源；结构参考来自后端Schema。当前是基础文本编辑器，不是完整Kestra/Monaco或拖拽No-code。
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

E2E要求Docker可用、已构建后端JAR。自动创建临时MySQL、随机账号/端口、新JAR进程和静态预览，结束删除本次临时数据库容器并停止本次进程。不接业务库、不启动/停止IDEA服务。失败trace位于test-results，后端日志与截图位于.local/evidence，均不提交Git。Java全量测试仍用根scripts/verify.ps1。

尚无资源/应用/网关/账号管理页面、可视化编排、指标曲线、数据处理速率、产物下载或旧数据迁移。详细边界见[UI协议](../docs/contracts/ui-console.md)。

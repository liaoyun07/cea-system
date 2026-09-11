# UI-04 SELECT验证记录

日期：2026-09-12。状态：PASS，已按用户当次确认更新CEA前后端。源码基线e541a32c341bb58eb842a06f1c71ed19c9c178a1加本批改动；本文件随同一功能提交追溯。下方时间除注明外均为Asia/Shanghai。

范围见[功能规格](../features/UI-04-select-input.md)。环境沿用Windows、JDK21、Node24.19.0、Vue3.5.42、Vite8.3.0、Playwright1.63.0和隔离Docker MySQL/Registry/K3s；不是旧系统部署或切换。

## 自动化验收

- JDK21完整scripts/verify.ps1通过：215项Maven（runtime 35、server 179、打包JAR 1），0失败/错误/跳过。耗时11分47秒，00:57:31完成；包括既有FedAvg/FedProx、Registry/K3s/数据库故障恢复与JAR启动回归。
- runtime定向35项也通过；SELECT覆盖声明、原始元素类型、非空/重复/错误选项、默认值、必填/省略/null和JSON往返。拒绝数字选项而非静默转字符串。
- FlowManagement集成验收：保存回读values、默认预览；直接提交/Webhook/策略/预览拒绝非法值，拒绝时不创建Execution；定时输入和默认值在保存时校验。修改选项不污染既有Execution输入快照，旧修订仍可按原选项执行。
- Node单测30项通过，包含7类输入及SELECT的字符串“0”/“true”、默认值、省略和成员校验。
- 真实JAR/API浏览器36项全通过，耗时1.9分钟。新增No-code创建SELECT/3选项/默认值/required、删除默认选项后拒绝保存而不替换、修正/保存/回读/预览/执行SUCCESS；无默认值不自选，未提供必填值或已启用但未选择时拒绝，选择后执行成功。其余34项原功能回归通过。
- 生产构建、Prettier及git diff --check通过；scaffold通过（8模块、86个生产Java索引、32功能编号）。桌面与650px窄屏实际截图检查通过。

本批无新增Java文件、表/列、API/SPI/执行链。Input.values的真实消费者和Kestra差异见规格；不实现动态选项、自定义值或多选。

## CEA部署与只读复核

用户明确允许同步更新CEA前后端，不修改现有流程，不重启数据库、Registry或算法集群。部署前分页检查执行及其TaskRun均已终结，记录两Flow与四条Execution及12个容器基线。

- 构建backend/frontend后，仅执行Invoke-CeaCompose up -d --no-deps --no-build --wait --wait-timeout 120 backend frontend；未运行整组start脚本。
- backend于01:01:15启动，容器00ce40ba2564，镜像sha256:505c1e1170331d99aac609feb22714081318479d0896586a70a2a31c349f7e16。
- frontend于01:01:20启动，容器861dee541719，镜像sha256:7a8e3a63bcea0abdcd62800259ba91c7fb7ffac74c16bc6a0fc154dfedde0e5d。入口18080，前端产物index-Ccoy7YvL.js / index-Bh4nlPbN.css。
- 两服务healthy，nginx -t通过。其他十个容器（MySQL、MinIO、四Registry、四K3s）ID和StartedAt逐个比较未变；无DB migration。
- 01:05真实18080浏览器复核PASS：未保存SELECT草稿显示类型/3选项/默认值并校验通过；真实API预览cloud返回200，非法选项返回422。草稿丢弃，不保存或执行测试流程。
- 原FedAvg r4/FedProx r2的Loop/目录选择/执行表单、管理目录/四集群部署查询，以及已有成功执行的6个train实例、输出、日志空态与API一致；无浏览器pageerror。
- 前后两次业务快照比较PASS：两Flow的源码/修订、四条Execution的ID/Flow修订/状态/输入/输出完全不变，未新增生产Execution。SELECT保存和执行验证在隔离测试环境完成，不将本次只读查询称作生产FedAvg重跑。

## 本地证据

- .local/UI04-runtime.log、.local/UI04-verify.log；frontend/.local/UI04-unit.log、UI04-e2e.log。
- .local/UI04-backend-build.log、UI04-frontend-build.log、UI04-deployed.log。
- frontend/.local/evidence/select-input.png、select-input-narrow.png；.local/cea/browser/select-definition.png及result.json。
- .local/UI04-business-before.json、UI04-containers-before.txt用于部署前后只读比对。实际凭据、快照、截图、构建产物和缓存不提交Git。

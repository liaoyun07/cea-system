# VER-ING-01 HTTP Ingress 验证

日期：2026-09-17。源码基线：`5e54930`及本批ING-01差异；工作区原有未提交联邦实验保留但不提交，不修改原算法。状态：PASS，已发布CEA并完成实际页面/四入口验收。

## 已执行

- JDK 21.0.12，完整`./scripts/verify.ps1`于02:19:43完成，17分43秒，BUILD SUCCESS。共284项：runtime 36、dataflow 7、server 240、打包启动1，0失败/错误/跳过。真实MySQL/K3s/Registry/文件/恢复和原执行链回归通过。
- 原K3s测试增加2项Ingress测试：Class/多规则创建查询、编辑、CAS冲突、只读与跨Namespace拒绝、非托管保护、Service引用检查、错误端口和规则拒绝。ImageDistributionTest 55/55通过；OpenAPI/record/Controller一致性通过。
- 前端54项单测、build、format:check通过；结构检查8模块、109 Java索引、32功能ID通过。
- 最终浏览器全回归61/61通过，3.5分钟；真实隔离K3s+Traefik创建/编辑/删除、Host/Exact/Prefix边界、CAS/权限/端口拒绝均通过，删除规则后Service/Pod保留。桌面1440px和窄屏390px截图已人工检查，长表在自身容器内滚动，不撑宽整页。
- 本地环境：Windows + Docker Desktop，真实隔离K3s v1.30.6，Traefik v3.7.13；不是模拟Kubernetes HTTP响应。

## 回归发现并修正

1. 首轮Java测试2失败/1错误：测试内嵌RBAC未同步新增Ingress权限。补齐测试清单后完整verify通过；生产权限清单也包含相同动作，没有关闭权限测试。
2. 首轮浏览器新用例使用的Alpine没有httpd；换为其自带nc HTTP测试服务。之后修正Service/匹配下拉框的自动化选择器，使用combobox语义定位。每轮原60项页面用例通过。
3. 真实HTTP测试发现Traefik默认字符前缀使`/api`误匹配`/api-other`。控制器清单显式开启`strictPrefixMatching`，保持测试的404断言，不降低验收要求。测试与CEA共用此控制器清单。

## CEA 发布和现场验收

- 用户明确允许四集群新增Traefik、入口和RBAC。02:27:31前后端与入口桥均健康；不执行全量start/initialize，不重启集群、Registry、MySQL或算法服务。原镜像保留为`cea/backend:before-ing01`与`cea/frontend:before-ing01`，无DB migration。
- 四集群逐一实测Host正确/错误、Prefix路径段边界、Exact、更新撤销旧路径、删除变404；原Service UID和Deployment readyReplicas不变。随后每集群保留`ing01-http-demo` Deployment/Service/Ingress，复用原`httpserver/v1`镜像，回传JSON包含cluster/pod/path，未修改应用版本或算法镜像。
- 本机入口：cloud 18090、edge-a 18091、edge-b 18092、edge-c 18093。02:30实际18080页面逐一点击四个“访问”链接，新窗口返回对应集群JSON；页面错误0，桌面1440px和390px截图人工复核通过。仅本机HTTP，不代表公网、DNS、TLS或跨主机验收。
- 发布前后348条执行、44个Flow的当前定义、数据集、边缘策略、卸载样本完全相等；原Deployment/Service/Namespace的UID/spec/labels/annotations保持。原19个Compose容器中只替换backend/frontend，其他17个容器ID/镜像/启动时间不变；新增ingress-access后共20个。
- 初次现场Host探测受Node 24 fetch请求行为影响，curl同请求已通；改用node:http显式发送Host后四集群通过。只清理并重新创建该次失败探测自己的cloud三个示例对象，未删除基线资源。保留核对中将内存对象与JSON文件统一序列化，消除undefined与缺失字段的表示差异，没有跳过任何原资源字段比较。

验证脚本`deploy/cea/verify-ingress.mjs`分别执行capture/probe/verify/browser；私有证据在`.local/cea/ing01/`的before/probes/after/browser.json和两张页面图，不入公开Git。日志`.local/ing01-verify-final.log`、`ing01-browser-verified.log`、`ing01-infra-release.log`保留真实结果。probe不盲目覆盖同名对象，历史证据也不覆盖。

本批修改原2个生产Java文件并增加4个record、6个HTTP操作、1个前端组件；无新生产Java文件/业务表/数据库列/SPI/执行状态机。沿用Kubernetes资源模型，不涉及Kestra工作流语义。TLS/证书、复杂路由中间件和Gateway API仍未实现。

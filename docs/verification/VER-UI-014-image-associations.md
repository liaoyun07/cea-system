# VER-UI-014 镜像关联展示

状态：已验证并于2026-09-17 23:33发布CEA前后端；首次完整后端回归的夹具断言修正及定向复测如下。

范围见[UI-14](../features/UI-14-image-associations.md)。基线cea2fdc；保留工作树中既有联邦实验改动，仅纳入本批管理功能。

已完成：56项Node单测、Vite构建、Prettier；5项镜像页面定向Playwright（Registry请求受控夹具、仅认证和页面初始化读取现有CEA），覆盖关联/部署/空/不可用、删除禁用、桌面与390px窄屏；截图已人工检查。随后真实隔离后端/Registry/K3s的完整浏览器回归74/74通过（3.9分钟，含上述5项，不重复累计）；实际上传、解除应用关联后删除Registry、部署编辑/扩缩容、Service/Ingress与Flow/参数/数据集回归通过。

## 后端测试

- Windows、JDK21、Maven，独立真实MySQL/Registry/K3s/MinIO/终端测试容器。为避免上一批并发测试进程问题，本批Java和完整浏览器重型套件串行执行；测试JVM限堆768MiB、Metaspace256MiB，生产JVM不改。
- `scripts/verify.ps1`完整运行281个单元/集成用例，280通过，1个测试断言失败：同一K3s在联邦测试中配置了6个集群别名，零副本Deployment查询正确返回6个别名；测试原本错误假定仅有edge一条。运行中审查发现该夹具假设并修正为必须包含edge，且全部记录均指向目标Namespace/Deployment；生产实现未因此修改。
- 23:27:31定向Maven verify：原Registry完整删除回归及新增副本/已完成Job用例2/2通过，实际打包JAR启动1/1通过，BUILD SUCCESS。共覆盖282个不同Java用例，不表述为一次完整verify全部通过。首次定向命令因PowerShell未引用含点参数而未启动任何测试，补引号重跑；日志保留。
- 新增用例用真实Alpine Job执行成功后保留Job和Pod，先验证活动应用关联禁止删除，再解除应用关联并实际删除manifest；历史Job仍保留。源tag移动、已有副本复用且无新分发记录、旧无分发记录副本、零副本Deployment、多平台索引、权限和确认串均已验证。
- 本地证据：`.local/ui14-java.log`、`.local/ui14/full-ImageDistributionTest.xml`、`.local/ui14-java-retest.log`；未提交日志、凭据、构建产物。

## CEA发布与核验

发布前再次只读核对：44个Flow、348条执行（无活动执行）、71个应用版本、14个数据集版本、13个策略；四仓库镜像47/38/23/23条，共131条；现有部署与20个CEA服务镜像/容器身份均与初始基线一致。

只重建并更新backend/frontend，二者健康；数据库、Registry、算法集群和其他18个服务未重启，没有数据迁移、镜像/目录/历史删除。发布后上述全部业务列表、镜像库存、现有Deployment响应逐项一致；其他18服务的容器ID/镜像ID/启动时间完全相同。

- backend：`cea/backend:ui14-20260917` / local，`sha256:043c5f3654c9e26e547ec645994f3e2d2c491314c2a7cb66058b32175cd5aad6`。
- frontend：`cea/frontend:ui14-20260917` / local，`sha256:741ab65fe53c8502bea2148c3a749988ece4ba0b586fa8d21c6a107530ddf88e`。
- 旧版本保留为各自`rollback-ui14-20260917`：backend `sha256:4a285ed4df17be4bb1bdd1bb5fd6dc4a0dddd8ad4c26f8372eea0b52bb2e0f34`，frontend `sha256:5c185fd029657cc9d81cb81887b2173a19336026d61905868676db7e3f211897`。回滚应恢复匹配的前后端，本批无DB变更。

实际18080页面（非请求模拟）：lab/federated显示5个met01-v3应用版本；lab/fl-evaluate的32db…副本显示fl-evaluate/met01-v3且无服务部署；lab/httpserver显示httpserver/v1及cloud/cea-lab内http-server、ing01-http-demo、test三个部署。关联均禁止删除，无工作负载历史列表。桌面1440px与窄屏390px通过，浏览器JS错误0、API写请求0；实际截图已查看。

证据在忽略目录`.local/ui14/`及`.local/ui14-e2e.log`、`.local/ui14-deploy.log`。结构检查（109个既有Java文件、8模块、依赖无环）和git diff检查通过。没有新增生产类、HTTP路径、表或执行链；新增响应applications/deployments及内部只读查询，Kestra通用语义不涉及。

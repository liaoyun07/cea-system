# VER-EP-002 边缘处理记录

日期：2026-09-13。基线：1a6d491。当前实现与验收范围：[EP-02](../features/EP-02-processing-records.md)。

## 当前验证

已完成：EdgeAccessTest定向21项回归PASS（新增3项真实MySQL/API用例），50项Node单测与前端构建/格式/结构检查PASS。21:35:47完整JDK21/Maven verify通过：35项runtime、204项server、1项打包启动，共240项，0失败/错误/跳过；耗时13:59，原Registry/K3s组47项约617秒。原始日志`.local/ep02-verify.log`。

最终21:46浏览器57项全部PASS（3.4分钟，`.local/ep02-browser-rerun.log`）；包括21条真实策略执行分页、来源、停用后r1快照、READ用户、原输出、FAILED、503恢复、桌面/390px，既有真实K3s产物/Metrics、注册分发与部署操作均通过。首次回归为54通过/3失败（`.local/ep02-browser.log`），排错如下。使用历史快照作fixture的早期排版预览仅证明排版，不替代本次真实API/生产验收。首次verify在结构检查发现新规格链接的验证文档尚未创建，未进入Maven；补文档后完整重跑通过。

首次浏览器回归中新脚本有两处错误：普通Flow种子用了PUT /flows/{id}，实际保存接口为POST /flows/{id}/revisions（405）；嵌套label的严格getByLabel查询未命中，下拉框实际可访问角色名为策略/状态。修正种子接口并改用combobox角色定位，未修改或放宽生产API/权限/表单逻辑；最终重跑通过。

同轮旧Metrics用例失败：浏览器runtime-fixture还使用FILE-01之前的storage.lab.endpoint等配置，也没有Pod助手镜像。同步隔离fixture至现有stores/outputs/helper配置，将临时MinIO放入测试网络并提供Pod可达地址；从当前助手源码构建并导入临时K3s。只修测试基础设施，不恢复生产旧配置兼容分支，不扩大CEA权限，不改Java或算法。

## 实际发布

21:46:47 backend、21:46:53 frontend启动，21:47健康检查通过并reload前端代理；只替换两个服务。恢复镜像`cea/backend:before-ep02`、`cea/frontend:before-ep02`保留，无DB迁移、配置重写或新增权限。

- backend image：`sha256:ad8001aa284640536ba45f5cc06fc85f2a38e8b79a15b24b39c3d3c4d0e11037`。
- frontend image：`sha256:adf8d3a8070ab0cc345de143f884e1d3474c1ea5a95b4718020ba035cc0e5c2b`。
- `verify-edge-records.ps1`前后快照核对PASS：2个USER Flow、3个EDGE_POLICY、10条Execution输入/输出/状态/时间、2个DatasetVersion原值不变；其余15容器ID、镜像和StartedAt不变。接入/文件助手/存储配置未改，没有新生产Execution。
- 21:48实际18080浏览器PASS：三条SUCCESS记录原ID/可信来源/输出；筛选、详情、返回保留筛选、1600px与390px；原summary.json、diagnosis.json、report.json均经受权API成功预览，浏览器无pageerror。
- 原始证据：`.local/cea/ep02/before.json`、`after.json`、`browser.json`、`desktop.png`、`narrow.png`，构建/发布日志`.local/ep02-build.log`、`ep02-deploy.log`，均不入Git。

复核入口：[只读数据及服务对照](../../deploy/cea/verify-edge-records.ps1)、[真实页面复核](../../frontend/tests/verify-edge-records-live.mjs)（账号仅由进程环境提供，不输出凭据）。无新Java文件/表/列/SPI；7个既有Java文件增加查询方法及3个只读record、1个GET，执行主链不变。未补上传失败审计、数据处理速率、终端领取确认或新的下载能力。

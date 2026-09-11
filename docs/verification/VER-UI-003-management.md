# VER-UI-003 管理功能迁移

日期：2026-09-11。源码基线：`7bb0123`加本次UI-03变更。范围：[UI-03规格与缺口矩阵](../features/UI-03-management.md)。没有修改旧AMIS/web-platform或旧数据，也没有新Java/表/字段/API/SPI。

## 环境和执行

- Windows、Node 24.19.0、JDK 21.0.12、Docker Desktop（D盘）；Vue/Vite/Playwright沿用UI-02锁定依赖。
- 浏览器使用本次新建MySQL、Registry、Skopeo和K3s、随机账号/端口及真实打包JAR。K3s/API限制在测试网络/环回端口；测试结束清理本次容器、网络及临时kubeconfig。不写CEA业务库。
- `npm test`：29项通过（原23+6项管理请求/契约转换）；`npm run build`通过。
- 根`verify.ps1 -JavaHome C:\Users\liaoy\.jdks\ms-21.0.12.1`：2026-09-11 14:15:09 +08:00通过，11分13秒，212项Maven零失败/错误/跳过；ImageDistributionTest内部验证的7项联邦算法+5项卸载Python测试同时通过。生产Java没有变化，回归仍实际重跑。
- 浏览器最终发布轮28项全部通过（原19+9项管理），耗时1.4分钟；布局和刷新收尾后的完整复测PASS。`npm run format:check`、构建及结构检查通过。

## 新增浏览器覆盖

| 场景 | 验证内容 |
|---|---|
| 候选分页与离开确认 | 真实登记105个额外集群，选择第100项以后的候选；650px窄屏不横向溢出；同页导航取消/确认放弃草稿 |
| 集群 | 创建CLOUD目录、禁用、读回一致、其他namespace 403 |
| 数据集 | S3位置登记、原版本不可编辑、不同内容同版本409保留原记录、复制新版本 |
| 应用和镜像 | 参数false默认值、DatasetRule白名单持久化；真实Skopeo复制并返回目标digest |
| 网关/终端 | 非CONNECT账号403、正确账号登记；固定归属只读、启停读回、真实心跳更新时间 |
| 策略 | No-code生成并保存同一Flow；USER入口访问策略409；CAS冲突保留草稿；刷新后启用，真实网关事件提交得到SUCCESS |
| Deployment | 真实Registry/K3s创建sleep容器，readyReplicas=1；外部更新使旧resourceVersion删除409；明确刷新重试后删除，查询404 |
| 只读与卸载目录 | viewer修改403；空samples明确显示暂无记录，不造DQN数据 |
| 目录错误 | 浏览器故障注入断开读取：显示不可达而非成功空目录；依赖读取失败禁止登记，恢复后可重试 |

平台主执行链、已有Flow编辑/执行/取消/日志/动态任务实例、FedAvg/FedProx定义往返等由既有19项浏览器测试覆盖。此批只触发Log/Sleep策略测试；未在CEA重新提交联邦训练，也不是物理多云性能测试。

## 首轮失败和修正

首轮22通过、6失败，未记为验收PASS：4项为嵌套label/select的精确标签定位超时，候选本身已全部返回；补充明确aria-label。另1项测试误期望USER读取EDGE_POLICY为404，源码实际为管理范围冲突409，按现有契约更正断言。部署测试在删除响应尚未完成时断言错误提示，改为等待成功/错误结果后判断。未放宽业务断言、测试时限或改后端以迎合测试。

之后全部28项通过。布局复核将只读应用契约压缩为表格；目录刷新先清除旧页记录，避免错误分页时错认数据。最终结果见下节。

布局收尾后的复测27通过、1失败：策略修订断言使用`.policy-flow h2`，No-code异步挂载后同时匹配策略标题和内部“流程设置”。更正为精确匹配“策略 Flow r2”，不改业务代码或后端行为，再完整复测。

## 最终复测与CEA部署

最终发布轮28项全部通过，退出码0。实际证据：`frontend/.local/UI03-e2e-release.log`、`.local/UI03-verify.log`、Playwright截图/trace目录；不将凭据或测试产物提交Git。

按用户授权构建`cea/frontend:local`，执行`Invoke-CeaCompose up -d --no-deps frontend`。新frontend容器`bda5d2ae8d0d`健康，Nginx配置检查PASS；其他11个CEA容器ID和StartedAt逐一与更新前对比一致（backend仍`ebfe58123f2a`）。长镜像准备/部署请求的前端代理读取超时从90s调整至600s，与客户端长操作等待上限一致；不改变后端流程或自动重试语义。

14:31:01 +08:00运行`deploy/cea/verify-browser.mjs`实际只读检查PASS：应用5、集群4、数据集2；网关/终端/策略/卸载观测以及四集群Deployment均为0，与API一致。真实FedAvg/FedProx的保存定义、No-code/源码切换、成功执行/每个6个train实例、outputs及日志空态继续正常。没有新增/修改CEA业务记录或重新执行训练，没有重启其他服务。

浏览器截图目视检查了应用契约紧凑表格、数据位置、终端列表、策略No-code、Deployment就绪和窄屏布局，未见重叠或水平溢出。CEA证据在`.local/cea/browser/`，不提交业务内容截图。Git发布按持续授权执行，提交本批代码/文档/测试，不包含旧工程或真实连接文件。

## 尚未迁移

见规格的缺口矩阵：账号管理、完整Node/Service/Namespace、镜像tar上传/构建、持久分发历史、对象浏览下载、模板/执行记录删除没有对应新API。Deployment GET未返回原parameters/command，暂不提供可能清空配置的快捷启停/缩放或编辑。卸载研究和计量仍后置。

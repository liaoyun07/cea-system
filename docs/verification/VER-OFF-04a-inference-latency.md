# OFF-04a：逐次决策模型推理时延

日期：2026-09-23。源码：本工作区当前 main，发布提交号以最终记录为准。范围仅限 DQN 决策计时与列表/详情展示，不将该值称为卸载系统总时延。

## 实现与口径

- 所属边缘网关在 `dqn.py` 用单调时钟包围一次 `predict(model, state)`；`inferenceMs` 以毫秒返回，排除网关 RPC、动作筛选、排队、资源放置、文件和任务执行。
- 平台随动作把数值写入 `off_task_observation.inference_ms`，观察 API 原样返回；Flyway V30 新增可空列，不回填历史。重复请求沿用首次记录，不重写该值。
- 决策列表新增“决策时延”，详情显示“决策时延（模型推理）”。DQN 数值保留三位小数，旧记录显示“未采集”；FIXED/RULE 不存在模型推理，显示“不适用”。

## 实际验证

- `python -m unittest test_dqn.py`：4/4 通过，覆盖固定单调时钟差值 0.05 ms、合法动作、探索与输入约束。系统 Python 的完整 `test_gateway.py` 缺少 `botocore`，未将其算作通过；Java 真实网关集成用例覆盖同一 HTTP 路径。
- `scripts/verify.ps1`，JDK 21.0.7、Maven 3.8.8、Docker Desktop、隔离 MySQL：结构检查 8 模块/109 Java/32 功能 ID 通过；Maven verify 249 项测试和打包全部通过。首次运行仅因遗漏 OpenAPI `inferenceMs` 字段失败；补齐后先定向 27/27，再完整重跑成功。集成用例核验 DQN 决策返回并持久化非负数值、重放保留首值、V30 迁移和 FIXED/RULE 回归。
- `npm test` 58/58、`npm run build`、`npm run format:check` 通过；隔离 MySQL + 打包 JAR 的 `npm run test:e2e` 86/86 通过，包含决策列表与详情的三种显示状态。

## 当前 CEA 发布

发布前只读基线：369 条 Execution 均已结束，`wf_worker_job=0`；`off_task_observation=128`，其中 DQN 60 条；Flyway V29 已应用、V30 未应用。完整数据库备份保存在 Git 忽略目录 `.local/cea/off04a/cea-before-off04a-20260923.sql`，7185158 字节。原 backend/frontend/gateway 镜像已各标记 `before-off04a`，新镜像分别构建为 `off04a`。在无活动任务时仅重建 edge-gateway，实际容器镜像 ID `sha256:0a9a7e98…`、健康；容器内直接预测返回动作 1、`inferenceMs=0.014767`。本机 Vite 18100 已返回包含新列的脚本（HTTP 200）。新 Docker backend/frontend 镜像已更新本地标签但未启动，原 IDEA 后端继续服务，V30 尚未进入实际数据库。用户选择保留 IDEA 模式并自行重启后端；待重启后核验迁移和实际页面/API。此处不把测试通过或网关健康写成整项上线成功。

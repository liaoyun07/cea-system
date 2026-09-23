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

发布前只读基线：369 条 Execution 均已结束，`wf_worker_job=0`；`off_task_observation=128`，其中 DQN 60 条；Flyway V29 已应用、V30 未应用。完整数据库备份保存在 Git 忽略目录 `.local/cea/off04a/cea-before-off04a-20260923.sql`，7185158 字节。原 backend/frontend/gateway 镜像已各标记 `before-off04a`，新镜像分别构建为 `off04a`。在无活动任务时仅重建 edge-gateway，实际容器镜像 ID `sha256:0a9a7e98…`、健康；容器内直接预测返回动作 1、`inferenceMs=0.014767`。用户重启 IDEA 后端后，Flyway V30 成功；实际 API 200 且全部查询结果包含 `inferenceMs`，历史 60 条 DQN 保持 `null`。

按用户后续选择切回 Docker 后端。再次确认无活动执行或 Worker Job 后停止 IDEA 后端，Compose 只重建 backend/frontend，恢复网关指向 `http://backend:18085`。backend/frontend/gateway 镜像 ID 分别为 `sha256:50779eb0…`、`sha256:ba95df55…`、`sha256:0a9a7e98…`，均健康；18085 `/health`、观察 API、18080 页面均 200。真实浏览器确认“决策时延”列、FIXED“不适用”、历史 DQN“未采集”及详情展示。

主动追加一次既有 `off04-dqn` 小文件请求，不改策略或模型，保留独立 receipt `.local/cea/off02/receipts/off04a-inference-20260923.json`。执行 `4109a0d7-5211-49fa-a0f5-0a7ac721e07c` 的决策被记录为 DQN/TERMINAL，API `inferenceMs=0.056934`，18080 第 7 页列表与详情显示 `0.057 ms`，数值链路验收通过。但该执行最终 **FAILED**：约 120 秒后 `attempt timed out`；终端算法容器退出码 0 且 `result.json` 存在，后端反复记录 TerminalGatewayClient 的 IOException。可定位为推理完成后的终端结果确认/回传阶段，底层错误原因尚未核实；不将此执行记作任务成功，也未盲目重试或清理失败记录。该问题不影响本次计时字段已落库/展示的事实，但端到端卸载路径需另行排查。

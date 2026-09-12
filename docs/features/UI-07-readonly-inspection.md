# UI-07 产物、执行总览与只读集群资源

状态：DONE（实现、隔离验收与CEA发布完成）。消费者：WF-006执行查询、RES-001资源查询；不增加领域功能编号。

## 范围与边界

- 输出页通过output-files读取执行不可变definition中的容器输出声明，对应实际TaskRun及轮次/item；普通Flow和边缘策略均可读，不查USER限定的Flow管理API或回退当前修订。Metrics共用此声明查询。成功JSON按需调用UI-06 output-json；保留256KiB、成功Attempt和精确发布URI校验。非JSON仅展示URI，不做任意下载或对象存储管理。
- 总览查询runtime拥有的wf_execution，按created_at限定最近1..31个UTC自然日（今日截至查询时间），显示该批执行的当前状态数量、每日提交量及最近10次执行。失败和取消分开；不是状态事件趋势、吞吐或算法计量。SQL聚合全窗口，不分页累加到一半冒充完整总量。
- resource新增KubernetesResourceService，server新增KubernetesResourceController；先经ResourceCatalogService.cluster校验READ及集群目录，再打开已有显式连接。Node列出Ready/地址/容量/可分配量；容量不是利用率。Service只读配置命名空间；Namespace只GET该配置名称，不列全租户。Node/Service使用Kubernetes limit/continue，失败显示错误、不回退假数据。
- deployment/Placement/Runner/Executor/Worker/Binding均不改。无DB migration、新表、持久状态或SPI。

## 参考与简化

参考本地Kestra 0354ddf8cbd0d9bd32f5021a59fd982bc36ffdf4：ui/src/components/executions/Outputs.vue、FilePreview.vue及core/src/main/resources/dashboards/default_main_definition.yaml。沿用任务实例产物按需预览、总览时间窗口和状态分布，不引入Dashboard DSL/插件体系。Kestra Namespace不是Kubernetes Namespace；资源页按本项目现有连接边界实现，不用刷新创建Flow。

## 验收

真实MySQL统计跨页、时间边界/空窗口/身份隔离；真实K3s只读与命名空间/RBAC限制、分页和断连；真实S3/Job已有JSON接口回归与浏览器逐实例预览；桌面和390px操作、错误/空/刷新状态均已验证。220项Maven、41项Node、44项浏览器及构建/格式/scaffold通过。用户独立授权后，2026-09-12发布CEA前后端与受限只读RBAC，实际页面/API和历史保留验证通过，见[记录](../verification/VER-UI-007-readonly-inspection.md)。

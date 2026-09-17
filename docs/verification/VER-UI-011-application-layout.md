# VER-UI-011 应用入口与参数契约排版

日期：2026-09-17。基线：856cd97b及本批前端差异。原有联邦实验工作区变更不纳入本批。

状态：PASS，2026-09-17 17:39（Asia/Shanghai）已部署CEA 18080，仅更新frontend。

范围：三个操作按钮成组、参数卡片编号/字段/选项布局，保持原契约和执行链。不涉及后端或数据库变更。

## 自动化与视觉检查

- 54项Node单元测试、Vite build、Prettier check、git diff --check通过，包含原参数契约默认值/choices/数据集规则请求体往返。
- 新增4项只读Playwright检查：1440/900/390px操作按钮固定8px间距及窄屏换行；三个入口的单一参数标题、简短字段、默认值/允许值并排、值保持、数据集分支、添加/移除及重新编号。新构建预览4/4、实际18080最终4/4通过。
- 实际截图人工复核桌面及390px，无页面横向溢出；浏览器JS错误及API写请求均0。未提交任何注册/上传/构建或保存业务数据。
- check-scaffold通过（仅结构/文档校验）。本次未重跑完整Java、完整浏览器套件或真实镜像构建/导入；上述业务语义及后端未改。

## CEA发布

- 原镜像保留为`cea/frontend:rollback-ui11-20260917`，ID `sha256:a81ad5fd587010ea28b7b49c346bc7dff3a12b30aacfc1f49f9b5c2b8ce4f03d`。
- 新镜像`cea/frontend:ui11-20260917`，同时标记`cea/frontend:local`，ID `sha256:bb31a95c8bf808cba236aa41611f9299825160fd5b457984b112f64d0ed7fbbe`。
- Compose `up -d --no-deps --wait frontend`，健康通过；原44个Flow、348条执行、71个应用版本、14个数据集版本、13个策略完整列表不变，其他19服务容器ID/镜像/启动时间保持。
- 首次发布后4项页面测试已通过，但本地快照比较把不存在的health字段与`undefined`属性视为不同。修正验证器JSON序列化一致性后重跑，通过；不是生产服务变更，未重新部署/放宽容器ID或启动时间比对。
- 忽略目录`.local/ui11/before.json`、`after.json`保留前后快照；`frontend/.local/evidence/catalog-*.png`保留截图。凭据未写入证据或Git。

主调用链不变；无新增/删除生产组件、Java类、业务字段、表、接口或SPI，不涉及Kestra执行语义。仅改善排版，不改变JSON填写格式，也未新增后端能力。

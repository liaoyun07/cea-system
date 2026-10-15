# VER-REG-DOWN-01

2026-10-15，基于32fb059及保留的已有工作树。已发布并验证。

前端71项单测、Vite build和6项仓库浏览器用例通过（包含下载、错误恢复、原筛选/详情/删除/窄屏）。专项真实后端测试通过：HTTP归档→隔离Docker28 load/run、OCI索引与子摘要保留、READ/匿名/跨空间/仓库/路径/非法摘要/缺失校验、成功与失败临时目录为空。

JDK21.0.12.1/Maven3.8.8完整`scripts/verify.ps1`通过，313项Java测试、失败/错误/跳过均0，耗时20分38秒；含64项ImageDistributionTest和打包启动测试。结构检查通过：116个生产Java文件、模块依赖与文档链接有效。

初次验证发现Docker28经典镜像存储不支持直接load OCI；据此改为普通镜像Docker-save格式，多平台索引保留OCI格式，未绕过失败或宣称所有Docker都支持OCI。

## 实际CEA验证

- 只构建并更新backend/frontend，两者healthy；原镜像保留为`cea/backend:before-reg-down-20261015`和`cea/frontend:before-reg-down-20261015`。
- 从真实页面详情下载center仓库`lab/met04-small@sha256:e779e0ea263d837e67c75964ea0f67c89103af80d26dd0b1a300e4e9116a01b0`，保存为`lab-met04-small-e779e0ea263d.tar`。实际浏览器下载完成，无pageerror；归档RepoTags与摘要别名一致，config内容SHA-256与原仓库manifest的config digest一致。
- Skopeo对归档别名补全`docker.io/`属于标准短名称规范化，核验时仅归一化该前缀，不改变源仓库或请求摘要。
- 下载后的后端`/var/lib/cea/uploads/import/downloads`为空；仓库同页库存前后完全一致，其他29个CEA服务ID/启动时间保持。无业务数据、Flow、标签或镜像删除，无数据库迁移。验证脚本下载到本地的归档已删除，截图和结果保留在`.local/cea/registry-download/`，不提交缓存。
- `deploy/cea/verify-registry-download.mjs`提供发布前检查、浏览器回归与真实下载核验。测试脚本的导航标签歧义和标准RepoTag前缀断言已修正，最终运行通过；不涉及生产逻辑修正。

边界：未进行多GB归档/并发压测、断点续传或硬进程退出清理验证；普通镜像格式转换不承诺Registry manifest摘要不变，源码引用仍固定到完整摘要。

# platform-deployment

职责：应用镜像与部署生命周期。

S4-02a已实现应用版本契约的数据库登记/查询、标量参数及数据集规则校验。公开入口ApplicationCatalogService，仅本模块访问dep_application_version；通过ResourceCatalogService校验同namespace的数据集版本和格式。不派生Flow Inputs或任务绑定；参数来源属于Flow作者的显式定义。

当前不访问镜像仓库、不分发镜像、不创建常驻Deployment，也没有完整命名产物/路径注入契约。协议见[应用契约](../docs/contracts/s4-application-catalog.md)。

- [模块边界与 Java 文件索引](../docs/01-code-architecture.md)
- [功能索引](../docs/02-feature-index.md)
- [当前进度](../docs/04-progress.md)

项目依赖：`platform-resource`、`platform-foundation`，分别用于数据集规则校验与命名空间权限。spring-jdbc/Jackson沿用父BOM；无runtime依赖，不拥有Execution状态。

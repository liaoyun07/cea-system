# FND-001 工程和文档框架

关联：S0；[ADR-0001](../decisions/ADR-0001-module-boundaries.md)、[ADR-0002](../decisions/ADR-0002-scaffold-only.md)。状态以[功能索引](../02-feature-index.md)为准。

## 范围

建立 backend 独立Maven父工程和8模块、Java21构建基线、包元数据、文档与检查脚本。用户要求首步不实现具体逻辑。

## 非目标

不写Controller/Service/业务接口、不启动API、不建表、不迁数据、不改旧系统、不推镜像、不训练模型、不启动Docker。当前不选Spring Boot版本、不加入业务依赖。

## 接口和代码

入口是 scripts/check-scaffold.ps1 和 scripts/verify.ps1，无HTTP接口。生产Java索引见[代码架构](../01-code-architecture.md)。POM是构建配置，package-info是包文档，不表示功能实现。

## 验收条件

- 八个模块都具有独立POM和包声明，父子坐标一致。
- 依赖无环、无旧工程依赖，符合文档白名单。
- Java文件均登记，功能编号唯一，本地文档链接有效。
- 使用JDK21完成Maven verify；JDK8被明确拒绝。
- 脚本恢复临时JAVA_HOME，不修改系统设置。
- 进度明确说明没有业务逻辑和业务测试。
- 验证失败必须记录原因，不用禁用检查换取成功。


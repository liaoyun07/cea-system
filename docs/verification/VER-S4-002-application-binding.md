# VER-S4-002 历史验证：原S4-02a

本记录只描述已发布提交2d3c44f中的原实现，不是当前功能验收。自动Flow Input派生、独立alias/binding和plan/resolve已按用户方向修正撤销，原协议、示例和专用测试不再适用。最新决策见[ADR-0007](../decisions/ADR-0007-application-contract-binding.md)，当前验证见[VER-S4-003](VER-S4-003-explicit-flow-boundary.md)。

## 历史事实

验证基线为78203a7797ae9dfa086c750171406602f8bf28e5加当时未提交的工作区，随后发布为2d3c44f。Windows11、JDK21.0.7、Maven3.8.8、Docker29.5.3，真实Testcontainers MySQL8.0隔离库，未操作旧业务库或Registry。

2026-09-10 00:57:29 +08:00最终scripts/verify.ps1退出0，共101项（19单元、78真实MySQL集成、3协议、1架构），0失败/错误/跳过；约89秒。当时有57个生产Java、24个HTTP操作和33个record协议映射。原详细断言和执行记录可在Git提交2d3c44f查看，不将已撤销功能继续列作当前能力。

该次测试未验证真实镜像准备/分发、常驻Deployment、容器Job/产物、资源预约或真实多云，S4-02从未整体验收。

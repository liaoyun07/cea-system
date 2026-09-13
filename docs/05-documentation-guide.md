# 文档维护与可追溯规则

采用精简的 arc42 分层结构、ADR 决策记录和 Docs as Code，不完整照搬大型文档体系。

## 文档的唯一职责

| 文档 | 唯一用途 |
|---|---|
| 00-overview.md | 目标、模块职责、运行关系与范围 |
| 01-code-architecture.md | 当前项目结构、依赖白名单和全部生产Java文件 |
| 02-feature-index.md | 稳定功能编号、实现状态、验证状态 |
| 03-implementation-plan.md | 可修改路线、依赖、验收条件与范围变更 |
| 04-progress.md | 当前事实、问题、下一步及完成证据 |
| 06-deployment-safeguards-review.md | 生产保障已确认范围、最小边界与后置项；范围确认不等于已经实现 |
| 07-proposal-audit.md | 申报书要求到现有能力/证据的覆盖审查、缺口及范围取舍；不是第二份实现状态表 |
| features/ | 每个已开始功能的语义、异常规则、验收条件 |
| decisions/ | 重大取舍的背景、结论与后果 |
| contracts/ | DSL、API/事件、镜像/Worker/终端协议的语义权威入口 |
| verification/ | 实际测试环境、源码版本、结果和证据 |
| migration/ | 旧需求/能力到新功能的对应及切换规则 |

链接引用而不是复制多份状态表。功能索引是功能状态唯一汇总；进度文档只维护阶段与当次事实。数据库字段以迁移脚本、HTTP结构以OpenAPI为准，说明文档只补语义，防止双份协议漂移。

申报书审查表以稳定审查项关联功能编号及验证记录。功能或验收证据变化时，同批更新对应覆盖结论、剩余差距和审查基线；后置/裁剪需保留依据，不能删掉原文要求。当前最小功能已实现但申报书只部分覆盖时，要明确缺少的行为。性能结论必须另有符合口径的测量，不以页面存在或集成测试通过替代。

## 状态

- 实现：NOT_STARTED、SCAFFOLD、IN_PROGRESS、IMPLEMENTED、DEFERRED。
- 验证：NOT_RUN、PENDING、PASS、FAIL、PARTIAL。
- 阶段：NOT_STARTED、IN_PROGRESS、BLOCKED、DONE、REVERIFY。
- ADR：PROPOSED、ACCEPTED、SUPERSEDED；替换旧决策时保留原记录和指向。

IMPLEMENTED 不等于 PASS；无测试不是通过。框架可以 SCAFFOLD/PASS，但业务仍为 NOT_STARTED/NOT_RUN。只有阶段的全部验收条件满足才 DONE，不使用主观完成百分比。

## 关联链

功能编号 → ADR（如需要）→ Java文件/协议 → 测试类 → 验证记录。功能编号和ADR编号稳定；文件移动后更新索引和引用。后续每个生产类至少登记职责、关键接口、状态/事务、功能编号、测试入口。简单类型简写，核心状态机详细写。

验证记录绑定Git commit及脏工作区说明；未纳入有效Git或仓库尚无首次提交时使用文件SHA256清单，不伪造提交号。backend现为独立仓库，S1–S3首次提交为071ff4b；历史SHA256证据不重写。每份记录注明测试通过范围，尤其区别编译、单元测试、集成测试和真实多云验收。

## 更新时机与检查

新增/改动功能时同步更新相关文档，在同一批改动中提交。架构重大变化先写ADR；修改计划记原因和影响。S0已有脚本检查POM、Java索引、功能编号与本地链接；后续补类级依赖和协议兼容测试。不为生成文档堆出空业务实现。

README放启动方法，不再维护逐日开发流水账；历史修改交给Git和有意义的验证记录。

## 参考实践

- [arc42 Building Block View](https://docs.arc42.org/section-5/)：架构逐层映射到模块、接口与代码。
- [Architecture Decision Records](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)：背景、决策、状态及后果。
- [Docs as Code](https://www.writethedocs.org/guide/docs-as-code/)：文档与代码共同维护。
- [Spring Modulith 模块边界](https://docs.spring.io/spring-modulith/reference/fundamentals.html)：公开API、隐藏实现与依赖约束；当前未引入该库。

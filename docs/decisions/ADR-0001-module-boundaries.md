# ADR-0001 业务边界与终端卸载范围

日期：2026-09-08。状态：ACCEPTED（作为本次脚手架基线，可后续修订）。

## 背景

按Kestra技术层直接划全部平台模块会隐藏业务边界；按申报书四章节硬拆又把应用分发和协作等职责人为分开。用户明确“成熟合理的划分优先”，并限定卸载是终端任务卸载。

## 决策

采用dataflow/runtime/deployment/resource/edge/offloading/foundation/server八个模块。取消宽泛collaboration。应用分发策略和操作归deployment；资源观测、通用选址和预约归resource；边缘处理策略归edge。

offloading只对原始执行位置为终端且允许卸载的计算任务做决策。终端发起请求不代表整张流程都可卸载；普通固定/候选集群选址不自动进入DQN。执行和恢复统一由runtime承担。

模块不等于独立微服务；API/Executor/Scheduler/Worker是运行角色。通过使用方SPI和server装配避免runtime反向依赖业务。

## 后果

目录能体现业务而不一一对应申报书。须维护模块数据所有权及公共API；禁止将跨模块代码丢进foundation绕开边界。旧版181类清单及卸载通用选址职责仅作历史参考。

## 依据

最近用户职责讨论、[总览](../00-overview.md)、[迁移映射](../migration/README.md)。


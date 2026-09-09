/** 已实现定义/绑定、持久顺序执行、Worker租约恢复和失败策略，见S2规格。拥有运行状态、消息、日志及wf_worker_job六张表；Worker不直接修改执行状态。无platform业务模块依赖。 */
package com.project.platform.runtime;

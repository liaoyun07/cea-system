package com.project.platform.server.configuration;

import com.project.platform.dataflow.definition.*;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.executor.FlowExecutor;
import com.project.platform.runtime.executor.ExecutionReducer;
import com.project.platform.runtime.persistence.JdbcWorkerStore;
import com.project.platform.runtime.worker.WorkerEngine;
import org.springframework.beans.factory.annotation.Value;
import com.project.platform.runtime.persistence.JdbcExecutionStore;
import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
public class RuntimeConfiguration {
    @Bean com.project.platform.deployment.application.JdbcApplicationRepository applicationRepository(JdbcTemplate jdbc) {
        return new com.project.platform.deployment.application.JdbcApplicationRepository(jdbc);
    }
    @Bean com.project.platform.deployment.application.ApplicationCatalogService applicationCatalogService(
            com.project.platform.deployment.application.JdbcApplicationRepository repository,
            com.project.platform.resource.catalog.ResourceCatalogService resources,AccessPolicy access) {
        return new com.project.platform.deployment.application.ApplicationCatalogService(repository,resources,access);
    }
    @Bean Clock clock() { return Clock.systemUTC(); }
    @Bean JsonCodec jsonCodec() { return new JsonCodec(); }
    @Bean TemplateRenderer templateRenderer() { return new TemplateRenderer(); }
    @Bean FlowValidator flowValidator(TemplateRenderer renderer) { return new FlowValidator(renderer); }
    @Bean FlowParser flowParser(FlowValidator validator) { return new FlowParser(validator); }
    @Bean BindingResolver bindingResolver() { return new BindingResolver(); }
    @Bean AccessPolicy accessPolicy() { return new AccessPolicy(); }
    @Bean com.project.platform.resource.catalog.JdbcResourceRepository resourceRepository(JdbcTemplate jdbc,TransactionTemplate transactions) {
        return new com.project.platform.resource.catalog.JdbcResourceRepository(jdbc,transactions);
    }
    @Bean com.project.platform.resource.catalog.ResourceCatalogService resourceCatalogService(com.project.platform.resource.catalog.JdbcResourceRepository repository,AccessPolicy access) {
        return new com.project.platform.resource.catalog.ResourceCatalogService(repository,access);
    }
    @Bean TransactionTemplate transactions(PlatformTransactionManager manager) { return transactionTemplate(manager); }
    @Bean JdbcExecutionStore executionStore(JdbcTemplate jdbc, TransactionTemplate transactions, JsonCodec json) {
        return new JdbcExecutionStore(jdbc, transactions, json);
    }
    @Bean JdbcFlowRepository flowRepository(JdbcTemplate jdbc, TransactionTemplate transactions, JsonCodec json, Clock clock) {
        return new JdbcFlowRepository(jdbc, transactions, json, clock);
    }
    @Bean FlowService flowService(JdbcFlowRepository repository, FlowParser parser, AccessPolicy access, ExecutionService executions, com.project.platform.runtime.scheduler.SchedulerEngine scheduler) {
        return new FlowService(repository, parser, access, executions, scheduler);
    }
    @Bean ExecutionService executionService(JdbcExecutionStore store) { return new ExecutionService(store); }
    @Bean FlowExecutionService flowExecutionService(JdbcFlowRepository flows, ExecutionService executions,
                                                  BindingResolver bindings, JsonCodec json, AccessPolicy access) {
        return new FlowExecutionService(flows, executions, bindings, json, access);
    }
    private TransactionTemplate transactionTemplate(PlatformTransactionManager manager) {
        var template=new TransactionTemplate(manager);
        template.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
        return template;
    }
    @Bean com.project.platform.runtime.persistence.JdbcScheduleStore scheduleStore(JdbcTemplate jdbc,JsonCodec json) {
        return new com.project.platform.runtime.persistence.JdbcScheduleStore(jdbc,json);
    }
    @Bean com.project.platform.runtime.scheduler.SchedulerEngine schedulerEngine(JdbcExecutionStore store, com.project.platform.runtime.persistence.JdbcScheduleStore schedules, ExecutionService submissions,BindingResolver bindings,JsonCodec json) {
        return new com.project.platform.runtime.scheduler.SchedulerEngine(store,schedules,submissions,bindings,json);
    }
    @Bean JdbcWorkerStore workerStore(JdbcTemplate jdbc,TransactionTemplate transactions,JsonCodec json) {
        return new JdbcWorkerStore(jdbc,transactions,json);
    }
    @Bean ExecutionReducer executionReducer() { return new ExecutionReducer(); }
    @Bean FlowExecutor flowExecutor(JdbcExecutionStore store, JdbcWorkerStore workers,
                                              BindingResolver bindings, TemplateRenderer renderer, ExecutionReducer reducer) {
        return new FlowExecutor(store, workers, bindings, renderer, reducer);
    }
    @Bean(destroyMethod="close") WorkerEngine workerEngine(JdbcWorkerStore workers,TemplateRenderer renderer,
                                                        @Value("${platform.worker.lease-ms:3000}") long leaseMs,com.project.platform.runtime.worker.TaskRunner runner) {
        return new WorkerEngine(workers,renderer,leaseMs,runner);
    }
}

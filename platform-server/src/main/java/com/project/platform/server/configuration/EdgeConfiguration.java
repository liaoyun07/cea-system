package com.project.platform.server.configuration;

import com.project.platform.edge.*;
import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.runtime.definition.JsonCodec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
public class EdgeConfiguration {
    @Bean JdbcEdgeRepository edgeRepository(JdbcTemplate jdbc) { return new JdbcEdgeRepository(jdbc); }
    @Bean EdgeAccessService edgeAccessService(JdbcEdgeRepository repository,TransactionTemplate transactions,
            AccessPolicy access,ResourceCatalogService resources,FlowService flows,FlowExecutionService executions,JsonCodec json) {
        return new EdgeAccessService(repository,transactions,access,resources,flows,executions,json);
    }
}

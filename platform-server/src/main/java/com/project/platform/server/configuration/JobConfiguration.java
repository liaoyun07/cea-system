package com.project.platform.server.configuration;

import com.project.platform.dataflow.execution.ApplicationTaskRunner;
import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.deployment.distribution.ImageDistributionService;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.Action;
import com.project.platform.edge.EdgeAccessService;
import com.project.platform.offloading.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.resource.kubernetes.KubernetesConnections;
import com.project.platform.resource.placement.JobPlacementService;
import com.project.platform.resource.storage.ObjectStorage;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.worker.TaskRunner;
import com.project.platform.runtime.worker.CommonTaskRunner;
import com.project.platform.server.security.IdentityDirectory;
import java.util.Map;
import org.springframework.boot.context.properties.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
@EnableConfigurationProperties(JobConfiguration.Settings.class)
public class JobConfiguration {
    public record TerminalConnection(String dockerContext,Integer slots,com.project.platform.dataflow.execution.TerminalGatewayClient.Connection gateway) {
        public TerminalConnection {
            slots=slots==null?1:slots;
            if((dockerContext==null)==(gateway==null) || dockerContext!=null && !dockerContext.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,99}") || slots<1 || slots>100)
                throw new IllegalArgumentException("exactly one terminal Docker context or gateway connection and slots 1..100 required");
        }
    }
    @ConfigurationProperties("platform.jobs")
    public record Settings(Map<String,Map<String,Integer>> slots,Map<String,ObjectStorage.Configuration> storage,Map<String,Map<String,String>> helpers,
                           Map<String,Map<String,CommonTaskRunner.HttpConnection>> http,Map<String,Map<String,CommonTaskRunner.SqlConnection>> sql,
                           Map<String,Map<String,TerminalConnection>> terminals,Map<String,java.util.List<String>> centralClouds) {
        public Settings {
            slots=slots==null?Map.of():slots;storage=storage==null?Map.of():storage;http=http==null?Map.of():http;sql=sql==null?Map.of():sql;
            terminals=terminals==null?Map.of():terminals;
            helpers=helpers==null?Map.of():helpers;
            centralClouds=centralClouds==null?Map.of():centralClouds;
        }
    }
    @Bean JobPlacementService jobPlacementService(ResourceCatalogService resources,KubernetesConnections connections,JdbcTemplate jdbc,
            TransactionTemplate transactions,Settings settings,AccessPolicy access) {return new JobPlacementService(resources,connections,jdbc,transactions,settings.slots(),settings.centralClouds(),access);}
    @Bean ObjectStorage objectStorage(Settings settings){return new ObjectStorage(settings.storage());}
    @Bean JdbcOffloadingRepository offloadingRepository(JdbcTemplate jdbc,JsonCodec json){return new JdbcOffloadingRepository(jdbc,json);}
    @Bean OffloadingService offloadingService(JdbcOffloadingRepository repository,AccessPolicy access){return new OffloadingService(repository,access);}
    @Bean TaskRunner applicationTaskRunner(ApplicationCatalogService applications,ResourceCatalogService resources,ImageDistributionService images,
            JobPlacementService placement,KubernetesConnections connections,ObjectStorage storage,IdentityDirectory identities,EdgeAccessService edge,JsonCodec json,BindingResolver bindings,Settings settings,OffloadingService offloading,
            com.project.platform.dataflow.definition.NamespaceFileService namespaceFiles) {
        var applicationsRunner=new ApplicationTaskRunner(applications,resources,images,placement,connections,storage,job->{
            var execution=(Map<?,?>)job.context().get("execution");
            var actor=identities.actor((String)execution.get("submittedBy"));
            return actor.actions().contains(Action.CONNECT)?edge.workerActor(actor,(String)execution.get("namespace"),job.executionId()):actor;
        },job->{
            var execution=(Map<?,?>)job.context().get("execution");String namespace=(String)execution.get("namespace");
            var origin=edge.executionOrigin(identities.actor((String)execution.get("submittedBy")),namespace,job.executionId());
            var connection=settings.terminals().getOrDefault(namespace,Map.of()).get(origin.terminalId());
            if(connection==null)throw com.project.platform.runtime.model.WorkflowException.invalid("terminal","no terminal connection configured for request origin");
            return new ApplicationTaskRunner.TerminalTarget(origin.terminalId(),origin.clusterId(),connection.dockerContext(),connection.slots(),connection.gateway());
        },offloading,json,bindings,namespaceFiles,settings.helpers());
        var common=new CommonTaskRunner(settings.http(),settings.sql(),bindings);
        return context->context.job().task().container()!=null?applicationsRunner.run(context):common.run(context);
    }
}

package com.project.platform.server.configuration;

import com.project.platform.dataflow.execution.ApplicationTaskRunner;
import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.deployment.distribution.ImageDistributionService;
import com.project.platform.foundation.identity.AccessPolicy;
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
    @ConfigurationProperties("platform.jobs")
    public record Settings(Map<String,Map<String,Integer>> slots,Map<String,ObjectStorage.Connection> storage,
                           Map<String,Map<String,CommonTaskRunner.HttpConnection>> http,Map<String,Map<String,CommonTaskRunner.SqlConnection>> sql) {
        public Settings {slots=slots==null?Map.of():slots;storage=storage==null?Map.of():storage;http=http==null?Map.of():http;sql=sql==null?Map.of():sql;}
    }
    @Bean JobPlacementService jobPlacementService(ResourceCatalogService resources,KubernetesConnections connections,JdbcTemplate jdbc,
            TransactionTemplate transactions,Settings settings,AccessPolicy access) {return new JobPlacementService(resources,connections,jdbc,transactions,settings.slots(),access);}
    @Bean ObjectStorage objectStorage(Settings settings){return new ObjectStorage(settings.storage());}
    @Bean TaskRunner applicationTaskRunner(ApplicationCatalogService applications,ResourceCatalogService resources,ImageDistributionService images,
            JobPlacementService placement,KubernetesConnections connections,ObjectStorage storage,IdentityDirectory identities,JsonCodec json,BindingResolver bindings,Settings settings) {
        var applicationsRunner=new ApplicationTaskRunner(applications,resources,images,placement,connections,storage,identities::actor,json,bindings);
        var common=new CommonTaskRunner(settings.http(),settings.sql(),bindings);
        return context->context.job().task().container()!=null?applicationsRunner.run(context):common.run(context);
    }
}

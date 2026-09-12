package com.project.platform.server.configuration;

import com.project.platform.resource.kubernetes.KubernetesConnections;
import com.project.platform.resource.kubernetes.KubernetesConnections.Connection;
import java.util.Map;
import java.time.Clock;
import java.time.Duration;
import org.springframework.jdbc.core.JdbcTemplate;
import com.project.platform.deployment.service.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties({KubernetesConfiguration.Settings.class,KubernetesConfiguration.DeploymentSettings.class})
public class KubernetesConfiguration {
    @ConfigurationProperties("platform.kubernetes")
    public record Settings(Map<String,Map<String,Connection>> connections) {
        public Settings { connections=connections==null?Map.of():Map.copyOf(connections); }
    }
    @ConfigurationProperties("platform.deployment")
    public record DeploymentSettings(Duration timeout) {
        public DeploymentSettings { timeout=timeout==null?Duration.ofMinutes(10):timeout; }
    }
    @Bean JdbcDeploymentRecordRepository deploymentRecordRepository(JdbcTemplate jdbc) { return new JdbcDeploymentRecordRepository(jdbc); }
    @Bean(initMethod="start",destroyMethod="close") DeploymentRolloutTracker deploymentRolloutTracker(
            JdbcDeploymentRecordRepository records,KubernetesConnections connections,Clock clock) {
        return new DeploymentRolloutTracker(records,connections,clock);
    }
    @Bean KubernetesConnections kubernetesConnections(Settings settings) { return new KubernetesConnections(settings.connections()); }
    @Bean com.project.platform.resource.kubernetes.KubernetesResourceService kubernetesResourceService(
            com.project.platform.resource.catalog.ResourceCatalogService resources,KubernetesConnections connections,Clock clock) {
        return new com.project.platform.resource.kubernetes.KubernetesResourceService(resources,connections,clock);
    }
    @Bean com.project.platform.deployment.service.DeploymentService deploymentService(com.project.platform.foundation.identity.AccessPolicy access,
            com.project.platform.deployment.application.ApplicationCatalogService applications,
            com.project.platform.resource.catalog.ResourceCatalogService resources,
            com.project.platform.deployment.distribution.ImageDistributionService images,KubernetesConnections connections,
            JdbcDeploymentRecordRepository records,Clock clock,DeploymentSettings settings) {
        return new com.project.platform.deployment.service.DeploymentService(access,applications,resources,images,connections,records,clock,settings.timeout());
    }
}

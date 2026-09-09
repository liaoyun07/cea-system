package com.project.platform.server.configuration;

import com.project.platform.resource.kubernetes.KubernetesConnections;
import com.project.platform.resource.kubernetes.KubernetesConnections.Connection;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(KubernetesConfiguration.Settings.class)
public class KubernetesConfiguration {
    @ConfigurationProperties("platform.kubernetes")
    public record Settings(Map<String,Map<String,Connection>> connections) {
        public Settings { connections=connections==null?Map.of():Map.copyOf(connections); }
    }
    @Bean KubernetesConnections kubernetesConnections(Settings settings) { return new KubernetesConnections(settings.connections()); }
    @Bean com.project.platform.deployment.service.DeploymentService deploymentService(com.project.platform.foundation.identity.AccessPolicy access,
            com.project.platform.deployment.application.ApplicationCatalogService applications,
            com.project.platform.resource.catalog.ResourceCatalogService resources,
            com.project.platform.deployment.distribution.ImageDistributionService images,KubernetesConnections connections) {
        return new com.project.platform.deployment.service.DeploymentService(access,applications,resources,images,connections);
    }
}

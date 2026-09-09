package com.project.platform.server.configuration;

import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.deployment.distribution.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.resource.catalog.ResourceCatalogService;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(DistributionConfiguration.Settings.class)
public class DistributionConfiguration {
    @ConfigurationProperties("platform.distribution")
    public record Settings(List<String> command,Duration timeout,Map<String,RegistrySettings> registries,Map<String,Map<String,String>> targets) {
        public Settings {
            command=command==null?List.of("skopeo"):List.copyOf(command);
            timeout=timeout==null?Duration.ofMinutes(5):timeout;
            registries=registries==null?Map.of():Map.copyOf(registries);targets=targets==null?Map.of():Map.copyOf(targets);
        }
    }
    public record RegistrySettings(String address,Boolean tlsVerify,String authFile) {
        public RegistrySettings { tlsVerify=tlsVerify==null || tlsVerify; }
    }
    @Bean ImageDistributionService imageDistributionService(Settings settings,ApplicationCatalogService applications,
                                                           ResourceCatalogService resources,AccessPolicy access) {
        var registries=settings.registries().entrySet().stream().collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,
                e->new SkopeoImageClient.Registry(e.getValue().address(),e.getValue().tlsVerify(),e.getValue().authFile())));
        return new ImageDistributionService(applications,resources,access,new SkopeoImageClient(settings.command(),settings.timeout()),registries,settings.targets());
    }
}

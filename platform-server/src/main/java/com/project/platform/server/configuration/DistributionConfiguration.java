package com.project.platform.server.configuration;

import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.deployment.distribution.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.resource.catalog.ResourceCatalogService;
import java.time.Duration;
import java.time.Clock;
import org.springframework.jdbc.core.JdbcTemplate;
import java.nio.file.Path;
import com.project.platform.deployment.upload.ImageUploadService;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties({DistributionConfiguration.Settings.class,DistributionConfiguration.UploadSettings.class})
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
    @ConfigurationProperties("platform.image-upload")
    public record UploadSettings(Map<String,String> centers,Path directory,Long maxBytes,Integer concurrency) {
        public UploadSettings {
            centers=centers==null?Map.of():Map.copyOf(centers);
            directory=directory==null?Path.of(System.getProperty("java.io.tmpdir"),"cea-image-uploads"):directory;
            maxBytes=maxBytes==null?2L*1024*1024*1024:maxBytes;concurrency=concurrency==null?2:concurrency;
        }
    }
    @Bean ImageUploadService imageUploadService(Settings settings,UploadSettings uploads,AccessPolicy access,ApplicationCatalogService applications,SkopeoImageClient images) {
        var centers=new java.util.HashMap<String,SkopeoImageClient.Registry>();
        uploads.centers().forEach((namespace,name)->{
            var registry=settings.registries().get(name);
            if(registry==null)throw new IllegalArgumentException("upload center references unconfigured registry");
            centers.put(namespace,new SkopeoImageClient.Registry(registry.address(),registry.tlsVerify(),registry.authFile()));
        });
        return new ImageUploadService(access,applications,images,centers,uploads.directory(),uploads.maxBytes(),uploads.concurrency());
    }
    @Bean SkopeoImageClient skopeoImageClient(Settings settings) { return new SkopeoImageClient(settings.command(),settings.timeout()); }
    @Bean JdbcImageDistributionRepository imageDistributionRepository(JdbcTemplate jdbc) { return new JdbcImageDistributionRepository(jdbc); }
    @Bean ImageDistributionService imageDistributionService(Settings settings,ApplicationCatalogService applications,
                                                           ResourceCatalogService resources,AccessPolicy access,SkopeoImageClient images,JdbcImageDistributionRepository history,Clock clock) {
        var registries=settings.registries().entrySet().stream().collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,
                e->new SkopeoImageClient.Registry(e.getValue().address(),e.getValue().tlsVerify(),e.getValue().authFile())));
        return new ImageDistributionService(applications,resources,access,images,registries,settings.targets(),history,clock);
    }
}

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
@EnableConfigurationProperties({DistributionConfiguration.Settings.class,DistributionConfiguration.UploadSettings.class,DistributionConfiguration.BuildSettings.class})
public class DistributionConfiguration {
    @ConfigurationProperties("platform.image-build")
    public record BuildSettings(List<String> command,Path directory,Duration timeout) {
        public BuildSettings {
            command=command==null?List.of("buildctl","--addr","unix:///run/cea-buildkit/buildkitd.sock"):List.copyOf(command);
            directory=directory==null?Path.of(System.getProperty("java.io.tmpdir"),"cea-builds"):directory;
            timeout=timeout==null?Duration.ofMinutes(10):timeout;
        }
    }
    @Bean com.project.platform.deployment.upload.ImageBuildService imageBuildService(BuildSettings settings,AccessPolicy access,ApplicationCatalogService applications,ImageUploadService uploads) {
        return new com.project.platform.deployment.upload.ImageBuildService(access,applications,uploads,settings.command(),settings.directory(),settings.timeout());
    }
    @ConfigurationProperties("platform.distribution")
    public record Settings(List<String> command,Duration timeout,Map<String,RegistrySettings> registries,Map<String,Map<String,String>> targets) {
        public Settings {
            command=command==null?List.of("skopeo"):List.copyOf(command);
            timeout=timeout==null?Duration.ofMinutes(5):timeout;
            registries=registries==null?Map.of():Map.copyOf(registries);targets=targets==null?Map.of():Map.copyOf(targets);
        }
    }
    public record RegistrySettings(String address,Boolean tlsVerify,String authFile,String apiUrl) {
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
    @Bean RegistryHttpClient registryHttpClient() { return new RegistryHttpClient(); }
    @Bean RegistryManagementService registryManagementService(Settings settings,UploadSettings uploads,AccessPolicy access,ApplicationCatalogService applications,
            com.project.platform.resource.kubernetes.KubernetesManagementService kubernetes,JdbcImageDistributionRepository history,RegistryHttpClient client) {
        var registries=registryConnections(settings);
        var scopes=new java.util.HashMap<String,java.util.Set<String>>();
        settings.targets().forEach((namespace,targets)->scopes.put(namespace,new java.util.HashSet<>(targets.values())));
        uploads.centers().forEach((namespace,id)->scopes.computeIfAbsent(namespace,ignored->new java.util.HashSet<>()).add(id));
        return new RegistryManagementService(access,applications,kubernetes,history,client,registries,scopes);
    }
    @Bean JdbcImageDistributionRepository imageDistributionRepository(JdbcTemplate jdbc) { return new JdbcImageDistributionRepository(jdbc); }
    @Bean ImageDistributionService imageDistributionService(Settings settings,ApplicationCatalogService applications,
                                                           ResourceCatalogService resources,AccessPolicy access,SkopeoImageClient images,JdbcImageDistributionRepository history,Clock clock,RegistryHttpClient registry) {
        var registries=settings.registries().entrySet().stream().collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,
                e->new SkopeoImageClient.Registry(e.getValue().address(),e.getValue().tlsVerify(),e.getValue().authFile())));
        return new ImageDistributionService(applications,resources,access,images,registries,settings.targets(),history,clock,registry,registryConnections(settings));
    }
    private Map<String,RegistryHttpClient.Connection> registryConnections(Settings settings) {
        var connections=new java.util.HashMap<String,RegistryHttpClient.Connection>();
        settings.registries().forEach((id,r)->connections.put(id,new RegistryHttpClient.Connection(r.address(),r.apiUrl()==null?(r.tlsVerify()?"https://":"http://")+r.address():r.apiUrl(),r.authFile())));
        return connections;
    }
}

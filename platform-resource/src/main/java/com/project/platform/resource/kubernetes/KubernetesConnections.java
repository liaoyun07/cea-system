package com.project.platform.resource.kubernetes;

import io.fabric8.kubernetes.client.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** Explicit administrator-managed connections. Never reads the user's default kube context. */
public final class KubernetesConnections {
    public record Connection(String kubeconfig,String context,String namespace) {}
    private final Map<String,Map<String,Connection>> connections;
    public KubernetesConnections(Map<String,Map<String,Connection>> connections) {
        this.connections=connections.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey,e->Map.copyOf(e.getValue())));
        for(var clusters:connections.values())for(var value:clusters.values()) {
            if(value.kubeconfig()==null || value.context()==null || value.context().isBlank() || value.namespace()==null
                    || !value.namespace().matches("[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?"))
                throw new IllegalArgumentException("explicit kubeconfig, context and Kubernetes namespace required");
        }
    }
    public KubernetesClient open(String namespace,String clusterId) {
        var connection=connections.getOrDefault(namespace,Map.of()).get(clusterId);
        if(connection==null)throw com.project.platform.resource.catalog.ResourceException.invalid("Kubernetes connection is not configured for namespace/cluster");
        try {
            var config=Config.fromKubeconfig(connection.context(),Files.readString(Path.of(connection.kubeconfig())),connection.kubeconfig());
            config.setNamespace(connection.namespace());config.setRequestTimeout(10000);config.setConnectionTimeout(5000);
            return new KubernetesClientBuilder().withConfig(config).build();
        } catch(IOException ex) { throw new IllegalStateException("Cannot read configured Kubernetes credentials"); }
    }
    public java.util.Set<String> clusterIds(String namespace) { return connections.getOrDefault(namespace,Map.of()).keySet(); }
}

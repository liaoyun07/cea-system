package com.project.platform.resource.storage;

import io.minio.*;
import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import com.project.platform.resource.catalog.ResourceException;

/** Namespace-owned S3 artifact storage; credentials stay in the backend, never in task Pods. */
public final class ObjectStorage {
    public record Connection(String endpoint,String accessKeyFile,String secretKeyFile,String artifactBucket,Set<String> readableBuckets) {
        public Connection {
            readableBuckets=readableBuckets==null?Set.of():Set.copyOf(readableBuckets);
            if(endpoint==null || accessKeyFile==null || secretKeyFile==null || artifactBucket==null || artifactBucket.isBlank())throw new IllegalArgumentException("S3 endpoint, credential files and artifact bucket required");
        }
    }
    private final Map<String,Connection> connections;
    public ObjectStorage(Map<String,Connection> connections){this.connections=Map.copyOf(connections);}
    private Connection connection(String namespace) {
        var connection=connections.get(namespace);if(connection==null)throw ResourceException.invalid("object storage is not configured for namespace");return connection;
    }
    private MinioClient client(Connection c) throws IOException {
        return MinioClient.builder().endpoint(c.endpoint()).credentials(Files.readString(Path.of(c.accessKeyFile())).trim(),Files.readString(Path.of(c.secretKeyFile())).trim()).build();
    }
    public void download(String namespace,String uri,Path destination) throws Exception {
        var c=connection(namespace);var parsed=validateInput(namespace,uri);
        try(var client=client(c);var input=client.getObject(GetObjectArgs.builder().bucket(parsed.getHost()).object(parsed.getPath().substring(1)).build())) {
            Files.copy(input,destination,StandardCopyOption.REPLACE_EXISTING);
        }
    }
    public long size(String namespace,String uri) throws Exception {
        var c=connection(namespace);var parsed=validateInput(namespace,uri);
        try(var client=client(c)){return client.statObject(StatObjectArgs.builder().bucket(parsed.getHost()).object(parsed.getPath().substring(1)).build()).size();}
    }
    public URI validateInput(String namespace,String uri) {
        var c=connection(namespace);URI parsed;
        try {parsed=URI.create(uri);}catch(IllegalArgumentException ex){throw ResourceException.invalid("invalid S3 input URI");}
        if(!"s3".equals(parsed.getScheme()) || parsed.getHost()==null || parsed.getUserInfo()!=null || parsed.getQuery()!=null || parsed.getFragment()!=null
                || parsed.getPort()!=-1 || parsed.getPath()==null || parsed.getPath().length()<2
                || !(c.artifactBucket().equals(parsed.getHost()) ? parsed.getPath().startsWith("/"+namespace+"/") : c.readableBuckets().contains(parsed.getHost())))throw ResourceException.invalid("input URI is outside configured S3 namespace/buckets");
        return parsed;
    }
    public String publish(String namespace,String executionId,String taskRunId,int attempt,String name,Path file) throws Exception {
        var c=connection(namespace);String key=key(namespace,executionId,taskRunId,attempt,name);
        try(var client=client(c)) {
            client.uploadObject(UploadObjectArgs.builder().bucket(c.artifactBucket()).object(key).filename(file.toString()).build());
            if(client.statObject(StatObjectArgs.builder().bucket(c.artifactBucket()).object(key).build()).size()!=Files.size(file))throw new IOException("artifact size mismatch");
        }
        return "s3://"+c.artifactBucket()+"/"+key;
    }
    public String published(String namespace,String executionId,String taskRunId,int attempt,String name) throws Exception {
        var c=connection(namespace);String key=key(namespace,executionId,taskRunId,attempt,name);
        try(var client=client(c)){client.statObject(StatObjectArgs.builder().bucket(c.artifactBucket()).object(key).build());}
        return "s3://"+c.artifactBucket()+"/"+key;
    }
    private String key(String namespace,String executionId,String taskRunId,int attempt,String name) {return namespace+"/"+executionId+"/"+taskRunId+"/"+attempt+"/"+name;}
}

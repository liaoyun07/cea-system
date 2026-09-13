package com.project.platform.resource.storage;

import io.minio.*;
import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import com.project.platform.resource.catalog.ResourceException;

/** Namespace-owned S3 stores. Long-lived secret keys stay in the backend; helpers receive object grants only. */
public final class ObjectStorage {
    public record Connection(String endpoint,String transferEndpoint,String accessKeyFile,String secretKeyFile,String artifactBucket,Set<String> readableBuckets) {
        public Connection {
            readableBuckets=readableBuckets==null?Set.of():Set.copyOf(readableBuckets);
            transferEndpoint=transferEndpoint==null?endpoint:transferEndpoint;
            if(endpoint==null || accessKeyFile==null || secretKeyFile==null || artifactBucket==null || artifactBucket.isBlank())throw new IllegalArgumentException("S3 endpoint, credential files and artifact bucket required");
        }
    }
    public record Configuration(Map<String,Connection> stores,Map<String,String> outputs,String terminalStore) {
        public Configuration {
            stores=stores==null?Map.of():Map.copyOf(stores);outputs=outputs==null?Map.of():Map.copyOf(outputs);
            var buckets=new HashSet<String>();
            for(var store:stores.values()) {
                if(!buckets.add(store.artifactBucket()))throw new IllegalArgumentException("storage buckets must identify exactly one store");
                for(String bucket:store.readableBuckets())if(!buckets.add(bucket))throw new IllegalArgumentException("storage buckets must identify exactly one store");
            }
            if(!stores.keySet().containsAll(outputs.values()) || terminalStore!=null && !stores.containsKey(terminalStore))throw new IllegalArgumentException("unknown output store");
        }
    }
    private final Map<String,Configuration> configurations;
    public ObjectStorage(Map<String,Configuration> configurations){this.configurations=Map.copyOf(configurations);}
    private Configuration configuration(String namespace) {
        var config=configurations.get(namespace);if(config==null)throw ResourceException.invalid("object storage is not configured for namespace");return config;
    }
    private Connection connection(String namespace,URI uri) {
        return configuration(namespace).stores().values().stream().filter(c->c.artifactBucket().equals(uri.getHost()) || c.readableBuckets().contains(uri.getHost()))
                .findFirst().orElseThrow(()->ResourceException.invalid("input URI is outside configured S3 namespace/buckets"));
    }
    private MinioClient client(Connection c) throws IOException {
        return MinioClient.builder().endpoint(c.endpoint()).credentials(Files.readString(Path.of(c.accessKeyFile())).trim(),Files.readString(Path.of(c.secretKeyFile())).trim()).build();
    }
    public void download(String namespace,String uri,Path destination) throws Exception {
        var parsed=validateInput(namespace,uri);var c=connection(namespace,parsed);
        try(var client=client(c);var input=client.getObject(GetObjectArgs.builder().bucket(parsed.getHost()).object(parsed.getPath().substring(1)).build())) {
            Files.copy(input,destination,StandardCopyOption.REPLACE_EXISTING);
        }
    }
    public long size(String namespace,String uri) throws Exception {
        var parsed=validateInput(namespace,uri);var c=connection(namespace,parsed);
        try(var client=client(c)){return client.statObject(StatObjectArgs.builder().bucket(parsed.getHost()).object(parsed.getPath().substring(1)).build()).size();}
    }
    public URI validateInput(String namespace,String uri) {
        URI parsed;
        try {parsed=URI.create(uri);}catch(IllegalArgumentException ex){throw ResourceException.invalid("invalid S3 input URI");}
        if(!"s3".equals(parsed.getScheme()) || parsed.getHost()==null || parsed.getUserInfo()!=null || parsed.getQuery()!=null || parsed.getFragment()!=null
                || parsed.getPort()!=-1 || parsed.getPath()==null || parsed.getPath().length()<2
                || Arrays.stream(parsed.getPath().split("/",-1)).anyMatch(s->s.equals(".") || s.equals("..")))throw ResourceException.invalid("invalid S3 input URI");
        var c=connection(namespace,parsed);
        if(c.artifactBucket().equals(parsed.getHost()) && !parsed.getPath().startsWith("/"+namespace+"/"))throw ResourceException.invalid("input URI is outside configured S3 namespace/buckets");
        return parsed;
    }
    public String outputUri(String namespace,String cluster,boolean terminal,String executionId,String taskRunId,int attempt,String name) {
        var config=configuration(namespace);String store=terminal?config.terminalStore():config.outputs().get(cluster);
        if(store==null)throw ResourceException.invalid("no output store configured for execution location");
        return "s3://"+config.stores().get(store).artifactBucket()+"/"+key(namespace,executionId,taskRunId,attempt,name);
    }
    /** Short-lived method/object grants. The client region is explicit: signing does not contact the Pod endpoint. */
    public String grant(String namespace,String uri,boolean upload) throws Exception {
        var parsed=validateInput(namespace,uri);var c=connection(namespace,parsed);
        if(upload && !c.artifactBucket().equals(parsed.getHost()))throw ResourceException.invalid("cannot upload to input bucket");
        try(var signer=MinioClient.builder().endpoint(c.transferEndpoint()).region("us-east-1")
                .credentials(Files.readString(Path.of(c.accessKeyFile())).trim(),Files.readString(Path.of(c.secretKeyFile())).trim()).build()) {
            return signer.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder().bucket(parsed.getHost()).object(parsed.getPath().substring(1))
                    .method(upload?io.minio.http.Method.PUT:io.minio.http.Method.GET).expiry(3600).build());
        }
    }
    public String publish(String namespace,String uri,Path file) throws Exception {
        var parsed=validateInput(namespace,uri);var c=connection(namespace,parsed);String key=parsed.getPath().substring(1);
        if(!c.artifactBucket().equals(parsed.getHost()))throw ResourceException.invalid("cannot publish to input bucket");
        try(var client=client(c)) {
            client.uploadObject(UploadObjectArgs.builder().bucket(c.artifactBucket()).object(key).filename(file.toString()).build());
            if(client.statObject(StatObjectArgs.builder().bucket(c.artifactBucket()).object(key).build()).size()!=Files.size(file))throw new IOException("artifact size mismatch");
        }
        return uri;
    }
    public String published(String namespace,String uri) throws Exception {
        var parsed=validateInput(namespace,uri);var c=connection(namespace,parsed);String key=parsed.getPath().substring(1);
        if(!c.artifactBucket().equals(parsed.getHost()))throw ResourceException.invalid("not a published artifact bucket");
        try(var client=client(c)){client.statObject(StatObjectArgs.builder().bucket(c.artifactBucket()).object(key).build());}
        return uri;
    }
    /** Read only the exact artifact published by this task attempt, never a caller-provided destination. */
    public byte[] readPublished(String namespace,String executionId,String taskRunId,int attempt,String name,String uri,int limit) throws Exception {
        var parsed=validateInput(namespace,uri);var c=connection(namespace,parsed);String key=key(namespace,executionId,taskRunId,attempt,name);
        if(!("s3://"+c.artifactBucket()+"/"+key).equals(uri))throw ResourceException.invalid("output is not this task attempt's published artifact");
        try(var client=client(c);var input=client.getObject(GetObjectArgs.builder().bucket(c.artifactBucket()).object(key).build())) {
            byte[] bytes=input.readNBytes(limit+1);
            if(bytes.length>limit)throw ResourceException.invalid("JSON output exceeds "+limit+" bytes");
            return bytes;
        } catch(io.minio.errors.ErrorResponseException ex) {
            if(Set.of("NoSuchKey","NoSuchObject","NoSuchBucket").contains(ex.errorResponse().code()))throw ResourceException.missing("published output file is missing");
            throw ex;
        }
    }
    private String key(String namespace,String executionId,String taskRunId,int attempt,String name) {return namespace+"/"+executionId+"/"+taskRunId+"/"+attempt+"/"+name;}
}

package com.project.platform.deployment.distribution;

import com.project.platform.deployment.application.ApplicationException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;

/** Bounded Distribution v2 management requests to administrator-configured endpoints only.
 *  Image transport remains Skopeo. This adapter supports our anonymous/htpasswd Registries, not Harbor's management API. */
public final class RegistryHttpClient implements AutoCloseable {
    public record Connection(String address,String apiUrl,String authFile) {
        public Connection {
            var uri=URI.create(apiUrl);
            if(!Set.of("http","https").contains(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null
                    || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))throw new IllegalArgumentException("Registry API URL must be an HTTP(S) origin without credentials");
            apiUrl=apiUrl.replaceAll("/$","");
        }
    }
    public record Page(List<String> values,String next) {}
    public record Manifest(String digest,JsonNode document) {}
    private record Response(int status,byte[] body,HttpHeaders headers) {}
    private final JsonMapper json=JsonMapper.builder().build();
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    private static final String ACCEPT="application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json";
    static String encode(String value) { return URLEncoder.encode(value,StandardCharsets.UTF_8); }
    private Response request(Connection connection,String method,String path) {
        try {
            var request=HttpRequest.newBuilder(URI.create(connection.apiUrl()+path)).timeout(Duration.ofSeconds(20)).header("Accept",ACCEPT).method(method,HttpRequest.BodyPublishers.noBody());
            if(connection.authFile()!=null) {
                var file=Path.of(connection.authFile());if(Files.size(file)>65536)throw new IllegalArgumentException();
                var auths=json.readTree(Files.readString(file)).path("auths");
                var entry=auths.path(connection.address());
                if(entry.isMissingNode())entry=auths.path(connection.apiUrl());
                String auth=entry.path("auth").asString("");
                if(!auth.isEmpty()) { Base64.getDecoder().decode(auth);request.header("Authorization","Basic "+auth); }
            }
            // Buffering subscriber keeps the timeout active until the bounded response body is complete.
            var response=http.send(request.build(),info->new HttpResponse.BodySubscriber<byte[]>() {
                final java.util.concurrent.CompletableFuture<byte[]> result=new java.util.concurrent.CompletableFuture<>();
                final java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();java.util.concurrent.Flow.Subscription subscription;
                public java.util.concurrent.CompletionStage<byte[]> getBody(){return result;}
                public void onSubscribe(java.util.concurrent.Flow.Subscription value){subscription=value;value.request(1);}
                public void onNext(List<java.nio.ByteBuffer> buffers){
                    for(var buffer:buffers) {
                        if(bytes.size()+buffer.remaining()>2*1024*1024){subscription.cancel();result.completeExceptionally(new IllegalStateException());return;}
                        byte[] part=new byte[buffer.remaining()];buffer.get(part);bytes.writeBytes(part);
                    }subscription.request(1);
                }
                public void onError(Throwable error){result.completeExceptionally(error);}
                public void onComplete(){result.complete(bytes.toByteArray());}
            });
            if(response.statusCode()==401 || response.statusCode()==403)throw new SkopeoImageClient.Failure("Registry management authentication/permission denied (anonymous or htpasswd endpoint required)");
            if(response.statusCode()!=200 && response.statusCode()!=202 && response.statusCode()!=404)
                throw new SkopeoImageClient.Failure(response.statusCode()==405?"Registry manifest deletion is disabled":"Registry management request failed; refresh before retrying");
            return new Response(response.statusCode(),response.body(),response.headers());
        } catch(InterruptedException ex) { Thread.currentThread().interrupt();throw new SkopeoImageClient.Failure("Registry management request interrupted; outcome may be unknown"); }
        catch(SkopeoImageClient.Failure ex){throw ex;}
        catch(Exception ex){throw new SkopeoImageClient.Failure("Registry management connection, credentials or response could not be verified");}
    }
    public Page repositories(Connection connection,String last) {
        if(last!=null && (!last.matches("[a-z0-9][a-z0-9._/-]{0,254}") || last.contains("..")))throw ApplicationException.invalid("invalid Registry pagination cursor");
        return page(connection,"/v2/_catalog?n=100"+(last==null?"":"&last="+encode(last)),"repositories");
    }
    private Page page(Connection connection,String path,String field) {
        var response=request(connection,"GET",path);
        // Distribution 2 returns NAME_UNKNOWN for tags/list when a repository has only digest-addressed manifests.
        if(response.status()==404 && field.equals("tags"))return new Page(List.of(),null);
        if(response.status()==404)throw ApplicationException.missing("Registry catalog is unavailable");
        var collection=json.readTree(response.body()).path(field);
        if(!collection.isArray() && !(field.equals("tags") && collection.isNull()))throw new SkopeoImageClient.Failure("Registry returned an invalid inventory response");
        var values=new ArrayList<String>();for(var value:collection)values.add(value.asString());
        // Construct the next request ourselves. Never follow a Registry-supplied URL with credentials.
        return new Page(values,response.headers().firstValue("Link").isPresent() && !values.isEmpty()?values.getLast():null);
    }
    public List<String> tags(Connection connection,String repository) {
        var values=new ArrayList<String>();String next=null;var seen=new HashSet<String>();
        do {
            var page=page(connection,"/v2/"+repository+"/tags/list?n=100"+(next==null?"":"&last="+encode(next)),"tags");
            values.addAll(page.values());next=page.next();
            if(values.size()>5000 || next!=null && !seen.add(next))throw new SkopeoImageClient.Failure("Repository exceeds the 5000-tag management limit or returned an invalid cursor");
        } while(next!=null);
        return values;
    }
    public Manifest manifest(Connection connection,String repository,String reference) {
        if(!reference.matches("sha256:[a-f0-9]{64}|[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}"))throw ApplicationException.invalid("invalid image reference");
        var response=request(connection,"GET","/v2/"+repository+"/manifests/"+reference);
        if(response.status()==404)return null;
        String digest=response.headers().firstValue("Docker-Content-Digest").orElse("");
        if(!digest.matches("sha256:[a-f0-9]{64}") || reference.startsWith("sha256:") && !reference.equals(digest))throw new SkopeoImageClient.Failure("Registry returned an invalid manifest digest");
        verifyDigest(response.body(),digest);
        return new Manifest(digest,json.readTree(response.body()));
    }
    public JsonNode config(Connection connection,String repository,String digest) {
        if(!digest.matches("sha256:[a-f0-9]{64}"))throw new SkopeoImageClient.Failure("Registry returned an invalid config digest");
        var response=request(connection,"GET","/v2/"+repository+"/blobs/"+digest);
        if(response.status()!=200)throw new SkopeoImageClient.Failure("Image configuration is unavailable");verifyDigest(response.body(),digest);return json.readTree(response.body());
    }
    public void delete(Connection connection,String repository,String digest) {
        if(!digest.matches("sha256:[a-f0-9]{64}"))throw ApplicationException.invalid("deletion requires the exact sha256 digest");
        if(request(connection,"DELETE","/v2/"+repository+"/manifests/"+digest).status()!=202)throw new SkopeoImageClient.Failure("Registry did not acknowledge deletion");
        if(manifest(connection,repository,digest)!=null)throw new SkopeoImageClient.Failure("Registry deletion is not yet confirmed; refresh the inventory");
    }
    private static void verifyDigest(byte[] body,String expected) {
        try {
            String actual="sha256:"+HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(body));
            if(!actual.equals(expected))throw new SkopeoImageClient.Failure("Registry content does not match its OCI digest");
        } catch(java.security.NoSuchAlgorithmException ex) {throw new IllegalStateException(ex);}
    }
    @Override public void close() { http.close(); }
}

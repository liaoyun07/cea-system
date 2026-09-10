package com.project.platform.runtime.worker;

import com.project.platform.runtime.definition.BindingResolver;
import com.project.platform.runtime.model.FlowDefinition.Binding;
import java.net.*;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.io.IOException;

/** Bounded HTTP and read-only JDBC leaves. Connections are namespace-scoped administrator configuration. */
public final class CommonTaskRunner implements TaskRunner {
    public record HttpConnection(String baseUri,String authorizationFile) {}
    public record SqlConnection(String url,String usernameFile,String passwordFile) {}
    private final Map<String,Map<String,HttpConnection>> http;
    private final Map<String,Map<String,SqlConnection>> sql;
    private final BindingResolver bindings;
    private static final int LIMIT=1_048_576;
    public CommonTaskRunner(Map<String,Map<String,HttpConnection>> http,Map<String,Map<String,SqlConnection>> sql,BindingResolver bindings) {
        this.http=http;this.sql=sql;this.bindings=bindings;
        for(var group:http.values())for(var c:group.values()) {
            URI uri=URI.create(c.baseUri());if(!Set.of("http","https").contains(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null)
                throw new IllegalArgumentException("HTTP connection must be an explicit HTTP(S) base URI without credentials/query/fragment");
        }
        for(var group:sql.values())for(var c:group.values())if(c.url()==null || !c.url().startsWith("jdbc:mysql://") || c.usernameFile()==null || c.passwordFile()==null)
            throw new IllegalArgumentException("SQL requires an explicit MySQL URL and read-only credential files");
    }
    @Override public WorkerJob.Result run(TaskContext context) throws Exception {
        String namespace=(String)((Map<?,?>)context.job().context().get("execution")).get("namespace");
        try {return context.job().task().http()!=null?request(context,namespace):query(context,namespace);}
        catch(InterruptedException ex){throw ex;}
        catch(Exception ex){return WorkerJob.Result.failed("external task failed ("+ex.getClass().getSimpleName()+")");}
    }
    @SuppressWarnings("unchecked") private Object resolve(TaskContext context,Binding binding) {
        return bindings.resolve(binding,context.job().context());
    }
    private WorkerJob.Result request(TaskContext context,String namespace) throws Exception {
        var h=context.job().task().http();var c=http.getOrDefault(namespace,Map.of()).get(h.connection());
        if(c==null)return WorkerJob.Result.failed("HTTP connection is not configured for namespace");
        if("POST".equals(h.method()) && context.prepared()!=null)return WorkerJob.Result.failed("HTTP POST result unknown; automatic replay refused");
        Object path=resolve(context,h.path());if(!(path instanceof String relative))return WorkerJob.Result.failed("HTTP path must be a string");
        URI base=URI.create(c.baseUri()),uri=base.resolve(relative).normalize();
        String basePath=base.getPath(),pathValue=uri.getPath();
        if(!Objects.equals(uri.getScheme(),base.getScheme()) || !Objects.equals(uri.getRawAuthority(),base.getRawAuthority()) || uri.getFragment()!=null
                || pathValue==null || (!pathValue.equals(basePath) && !pathValue.startsWith(basePath.endsWith("/")?basePath:basePath+"/"))
                || Arrays.stream(pathValue.split("/")).anyMatch(segment->segment.equals(".") || segment.equals("..")))return WorkerJob.Result.failed("HTTP path is outside configured connection");
        String body=h.body()==null?"":Objects.toString(resolve(context,h.body()),"");
        if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>LIMIT)return WorkerJob.Result.failed("HTTP request body exceeds 1 MiB");
        Duration timeout=Duration.parse(context.job().task().timeout());
        var request=HttpRequest.newBuilder(uri).timeout(timeout).method(h.method(),"GET".equals(h.method())?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body));
        if(c.authorizationFile()!=null)request.header("Authorization",Files.readString(Path.of(c.authorizationFile())).trim());
        if("POST".equals(h.method()))context.prepare("HTTP_POST_STARTED");
        context.check();
        try(var client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(timeout).build()) {
            var pending=client.sendAsync(request.build(),info->new LimitedBody());
            try {
                var response=pending.get(timeout.toMillis(),TimeUnit.MILLISECONDS);
                if(response.statusCode()<200 || response.statusCode()>=300)return WorkerJob.Result.failed("HTTP status "+response.statusCode());
                return WorkerJob.Result.success(Map.of("statusCode",response.statusCode(),"body",new String(response.body(),java.nio.charset.StandardCharsets.UTF_8)));
            } catch(Exception ex) {
                pending.cancel(true);
                if(ex instanceof InterruptedException interrupted)throw interrupted;
                return WorkerJob.Result.failed("POST".equals(h.method())?"HTTP POST result unknown; automatic replay refused":"HTTP request failed or timed out");
            }
        }
    }
    private WorkerJob.Result query(TaskContext context,String namespace) throws Exception {
        var s=context.job().task().sql();var c=sql.getOrDefault(namespace,Map.of()).get(s.connection());
        if(c==null)return WorkerJob.Result.failed("SQL connection is not configured for namespace");
        long millis=Duration.parse(context.job().task().timeout()).toMillis();
        var properties=new Properties();properties.setProperty("user",Files.readString(Path.of(c.usernameFile())).trim());properties.setProperty("password",Files.readString(Path.of(c.passwordFile())).trim());
        properties.setProperty("connectTimeout",Long.toString(Math.min(millis,10000)));properties.setProperty("socketTimeout",Long.toString(millis));
        properties.setProperty("allowMultiQueries","false");properties.setProperty("allowLoadLocalInfile","false");
        try(var connection=DriverManager.getConnection(c.url(),properties)) {
            connection.setReadOnly(true);connection.setAutoCommit(false);
            try(var statement=connection.prepareStatement(s.query())) {
                statement.setQueryTimeout((int)Math.max(1,(millis+999)/1000));statement.setMaxRows(1001);
                for(int i=0;i<s.parameters().size();i++)statement.setObject(i+1,resolve(context,s.parameters().get(i)));
                context.check();
                try(var results=statement.executeQuery()) {
                    var rows=new ArrayList<Map<String,Object>>();int bytes=0;var metadata=results.getMetaData();
                    if(metadata.getColumnCount()>100)return WorkerJob.Result.failed("SQL exceeds 100 columns");
                    while(results.next()) {
                        context.check();if(rows.size()==1000)return WorkerJob.Result.failed("SQL exceeds 1000 rows");
                        var row=new LinkedHashMap<String,Object>();
                        for(int i=1;i<=metadata.getColumnCount();i++) {
                            String name=metadata.getColumnLabel(i);if(row.containsKey(name))return WorkerJob.Result.failed("SQL column labels must be unique");
                            Object value=results.getObject(i);if(value!=null && !(value instanceof String || value instanceof Number || value instanceof Boolean))value=value.toString();
                            bytes+=name.length()*3+Objects.toString(value,"").length()*3;if(bytes>LIMIT)return WorkerJob.Result.failed("SQL result exceeds 1 MiB");row.put(name,value);
                        }
                        rows.add(row);
                    }
                    connection.rollback();return WorkerJob.Result.success(Map.of("rows",rows,"size",rows.size()));
                }
            } finally {connection.rollback();}
        }
    }
    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> body=HttpResponse.BodySubscribers.ofByteArray();
        private java.util.concurrent.Flow.Subscription subscription;private int size;
        public CompletionStage<byte[]> getBody(){return body.getBody();}
        public void onSubscribe(java.util.concurrent.Flow.Subscription value){subscription=value;body.onSubscribe(value);}
        public void onNext(List<ByteBuffer> buffers) {
            for(var buffer:buffers){size+=buffer.remaining();if(size>LIMIT){subscription.cancel();body.onError(new IOException("HTTP body exceeds 1 MiB"));return;}}
            body.onNext(buffers);
        }
        public void onError(Throwable error){body.onError(error);}
        public void onComplete(){body.onComplete();}
    }
}

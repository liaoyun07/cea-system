package com.project.platform.dataflow.execution;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.WorkflowException;
import com.project.platform.runtime.worker.TaskContext;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;

/** Authenticated, bounded terminal operations through a configured gateway; never a Flow-provided URL. */
public final class TerminalGatewayClient {
    public record Connection(String endpoint,String tokenFile) {
        public Connection {
            var uri=URI.create(endpoint);
            if(!Set.of("http","https").contains(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null || uri.getQuery()!=null
                    || uri.getFragment()!=null || !Set.of("","/").contains(uri.getPath()) || tokenFile==null)
                throw new IllegalArgumentException("gateway endpoint and token file required");
            endpoint=endpoint.replaceAll("/+$","");
        }
    }
    public record LocalFile(String fileId,long bytes) {
        public LocalFile {
            if(fileId==null || !fileId.matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}") || bytes<1 || bytes>67108864)
                throw WorkflowException.invalid("inputFiles","terminal file requires UUID v4 and bytes 1..64MiB");
        }
    }
    private final JsonCodec json;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    public TerminalGatewayClient(JsonCodec json){this.json=json;}
    public LocalFile file(Object value) {return json.read(json.write(value),LocalFile.class);}
    public Map<?,?> call(TaskContext context,Connection connection,String terminal,String operation,Object body) throws Exception {
        context.check();
        String token=Files.readString(Path.of(connection.tokenFile())).trim();
        var request=HttpRequest.newBuilder(URI.create(connection.endpoint()+"/internal/terminals/"+terminal+"/"+operation))
                .timeout(Duration.ofSeconds("offloading/decide".equals(operation)?3:90)).header("Authorization","Bearer "+token).header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.write(body))).build();
        var response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());
        byte[] bytes;
        try(var stream=response.body()){bytes=stream.readNBytes(1048577);}
        context.check();
        if(bytes.length>1048576)throw new IOException("gateway response exceeds limit");
        if(response.statusCode()==400 || response.statusCode()==403 || response.statusCode()==404 || response.statusCode()==409 || response.statusCode()==422)
            throw WorkflowException.invalid("terminal","gateway rejected "+operation+" ("+response.statusCode()+")");
        if(response.statusCode()!=200)throw new IOException("terminal gateway unavailable ("+response.statusCode()+")");
        return json.read(new String(bytes,java.nio.charset.StandardCharsets.UTF_8),Map.class);
    }
}

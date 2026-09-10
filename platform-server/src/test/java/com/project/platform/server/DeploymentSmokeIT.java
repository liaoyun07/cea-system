package com.project.platform.server;

import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import com.project.platform.runtime.definition.JsonCodec;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.*;

/** Starts the actual packaged JAR, not a Spring test slice or the test classpath. */
class DeploymentSmokeIT {
    @Test void packagedJarStartsOnFreshDatabaseAuthenticatesAndExecutes() throws Exception {
        try(var mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("s4_deploy").withUsername("s4_backend").withPassword("isolated-test-only")) {
            mysql.start();int port;try(var socket=new java.net.ServerSocket(0)){port=socket.getLocalPort();}
            Path jar=Path.of("target","platform-server-0.1.0-SNAPSHOT.jar");assertTrue(Files.size(jar)>1_000_000);
            Path log=Path.of("target","deployment-evidence","packaged-jar.log");Files.createDirectories(log.getParent());Process child=null;
            try {
                var process=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java.exe").toString(),"-jar",jar.toAbsolutePath().toString(),"--server.port="+port,"--logging.level.root=WARN");
                process.environment().putAll(Map.of("BACKEND_DB_URL",mysql.getJdbcUrl(),"BACKEND_DB_USER",mysql.getUsername(),"BACKEND_DB_PASSWORD",mysql.getPassword(),"BACKEND_USER","owner","BACKEND_PASSWORD","isolated-api-password","BACKEND_NAMESPACES","lab"));
                child=process.redirectErrorStream(true).redirectOutput(log.toFile()).start();
                var http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();String base="http://127.0.0.1:"+port+"/api/namespaces/lab";
                await().atMost(Duration.ofSeconds(45)).ignoreExceptions().until(()->http.send(HttpRequest.newBuilder(URI.create(base+"/flows")).timeout(Duration.ofSeconds(2)).build(),HttpResponse.BodyHandlers.discarding()).statusCode()==401);
                String auth="Basic "+Base64.getEncoder().encodeToString("owner:isolated-api-password".getBytes(StandardCharsets.UTF_8));var json=new JsonCodec();
                String source="schemaVersion: 1\nnamespace: lab\nid: deployed\ntasks: [{id: log, type: core.Log, message: actual-packaged-jar}]\noutputs: {message: {source: TASK_OUTPUT, taskId: log, port: message}}\n";
                var saved=http.send(HttpRequest.newBuilder(URI.create(base+"/flows/deployed/revisions")).header("Authorization",auth).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.write(Map.of("expectedRevision",0,"source",source)))).build(),HttpResponse.BodyHandlers.ofString());
                assertTrue(saved.statusCode()==200 || saved.statusCode()==201,saved.body());
                var submitted=http.send(HttpRequest.newBuilder(URI.create(base+"/executions")).header("Authorization",auth).header("Content-Type","application/json").header("Idempotency-Key",UUID.randomUUID().toString()).POST(HttpRequest.BodyPublishers.ofString("{\"flowId\":\"deployed\",\"inputs\":{}}")).build(),HttpResponse.BodyHandlers.ofString());
                assertEquals(202,submitted.statusCode(),submitted.body());String id=json.map(submitted.body()).get("executionId").toString();
                await().atMost(Duration.ofSeconds(20)).untilAsserted(()->{
                    var result=http.send(HttpRequest.newBuilder(URI.create(base+"/executions/"+id)).header("Authorization",auth).build(),HttpResponse.BodyHandlers.ofString());
                    var value=json.map(result.body());assertEquals("SUCCESS",value.get("state"));assertEquals("actual-packaged-jar",((Map<?,?>)value.get("outputs")).get("message"));
                });
            } finally {if(child!=null){child.destroy();if(!child.waitFor(10,TimeUnit.SECONDS)){child.destroyForcibly();assertTrue(child.waitFor(10,TimeUnit.SECONDS));}}}
        }
    }
}

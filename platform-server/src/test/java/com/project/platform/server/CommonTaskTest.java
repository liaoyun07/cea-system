package com.project.platform.server;

import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.executor.FlowExecutor;
import com.project.platform.runtime.worker.*;
import com.project.platform.runtime.persistence.JdbcWorkerStore;
import com.project.platform.runtime.model.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.testcontainers.containers.MySQLContainer;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CommonTaskTest {
    private final MySQLContainer<?> mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("s4_common").withUsername("backend_test").withPassword("isolated-test-only");
    private final Actor actor=new Actor("writer",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private ConfigurableApplicationContext context;private HttpServer http;private Path user,password,authorization;
    private ExecutorService httpThreads;
    private final AtomicInteger posts=new AtomicInteger();
    @BeforeAll void start() throws Exception {
        mysql.start();
        try {
            http=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);httpThreads=Executors.newVirtualThreadPerTaskExecutor();http.setExecutor(httpThreads);
            http.createContext("/",request->{
                if(!"Bearer isolated-test-token".equals(request.getRequestHeaders().getFirst("Authorization"))){request.sendResponseHeaders(401,-1);request.close();return;}
                if("POST".equals(request.getRequestMethod()))posts.incrementAndGet();
                String path=request.getRequestURI().getPath();
                if(path.equals("/slow"))try{Thread.sleep(1500);}catch(InterruptedException ex){Thread.currentThread().interrupt();}
                byte[] body=(path.equals("/big")?"x".repeat(1_048_577):"actual http response").getBytes(java.nio.charset.StandardCharsets.UTF_8);
                try{request.sendResponseHeaders(path.equals("/error")?503:200,body.length);request.getResponseBody().write(body);}finally{request.close();}
            });http.start();
            user=Files.createTempFile("s4-sql-user-",".txt");password=Files.createTempFile("s4-sql-password-",".txt");authorization=Files.createTempFile("s4-http-auth-",".txt");
            Files.writeString(user,"s4_reader");Files.writeString(password,"isolated-read-only");Files.writeString(authorization,"Bearer isolated-test-token");
            var grant=mysql.execInContainer("mysql","-uroot","-p"+mysql.getPassword(),"-e","CREATE DATABASE s4_business; CREATE USER 's4_reader'@'%' IDENTIFIED BY 'isolated-read-only'; GRANT SELECT ON s4_business.* TO 's4_reader'@'%';");
            assertEquals(0,grant.getExitCode());
            context=new SpringApplicationBuilder(BackendApplication.class).run("--server.port=0","--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false",
                    "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),"--spring.datasource.password="+mysql.getPassword(),
                    "--platform.security.users[0].name=writer","--platform.security.users[0].password=test-only","--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE","--logging.level.root=WARN",
                    "--platform.jobs.http.lab.service.base-uri=http://127.0.0.1:"+http.getAddress().getPort()+"/","--platform.jobs.http.lab.service.authorization-file="+authorization,
                    "--platform.jobs.http.lab.scoped.base-uri=http://127.0.0.1:"+http.getAddress().getPort()+"/api","--platform.jobs.http.lab.scoped.authorization-file="+authorization,
                    "--platform.jobs.sql.lab.business.url="+mysql.getJdbcUrl().replace("/s4_common","/s4_business"),"--platform.jobs.sql.lab.business.username-file="+user,"--platform.jobs.sql.lab.business.password-file="+password);
        }catch(Exception ex){stop();throw ex;}
    }
    @AfterAll void stop() throws Exception {
        if(context!=null)context.close();if(http!=null)http.stop(0);if(httpThreads!=null)httpThreads.close();mysql.stop();
        for(Path path:new Path[]{user,password,authorization})if(path!=null)Files.deleteIfExists(path);
    }
    private FlowExecutionService executions(){return context.getBean(FlowExecutionService.class);}
    private String submit(String task) {
        String id="common"+UUID.randomUUID().toString().replace("-","");
        context.getBean(FlowService.class).save(actor,"lab",id,0,"schemaVersion: 1\nnamespace: lab\nid: "+id+"\n"+task);
        return executions().submit(actor,"lab",UUID.randomUUID().toString(),new FlowExecutionService.Request(id,null,Map.of()));
    }
    private void drain(String id) {
        await().atMost(Duration.ofSeconds(10)).pollInterval(Duration.ofMillis(20)).until(()->{
            context.getBean(FlowExecutor.class).processNext();context.getBean(WorkerEngine.class).runOnce();return executions().get(actor,"lab",id).state().terminal();
        });
    }
    private String http(String method,String path,String timeout) {return """
            tasks:
              - id: request
                type: core.Http
                timeout: %s
                http:
                  connection: service
                  method: %s
                  path: {source: LITERAL, value: '%s'}
            outputs:
              body: {source: TASK_OUTPUT, taskId: request, port: body}
            """.formatted(timeout,method,path);}
    @Test void getUsesConfiguredAuthenticationAndRealOutput() {
        String id=submit(http("GET","/ok","PT3S"));drain(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
        assertEquals("actual http response",executions().get(actor,"lab",id).outputs().get("body"));
    }
    @Test void httpErrorsOversizeAndForeignDestinationsAreNotSuccess() {
        for(String path:List.of("/error","/big","http://unconfigured.invalid/")) {
            String id=submit(http("GET",path,"PT3S"));drain(id);assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());
        }
        for(String path:List.of("/api-other","/api/%2e%2e/ok")) {
            String id=submit(http("GET",path,"PT3S").replace("connection: service","connection: scoped"));drain(id);
            assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());
        }
        String id=submit(http("GET","/api/ok","PT3S").replace("connection: service","connection: scoped"));drain(id);
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
    }
    @Test void postUnknownResultIsNotReplayedOnLeaseTakeover() {
        int before=posts.get();String id=submit(http("POST","/ok","PT3S"));
        await().atMost(Duration.ofSeconds(5)).until(()->{context.getBean(FlowExecutor.class).processNext();return !executions().tasks(actor,"lab",id).isEmpty()&&executions().tasks(actor,"lab",id).getFirst().state()==ExecutionState.RUNNING;});
        var store=context.getBean(JdbcWorkerStore.class);var lease=store.claim("crashed-before-response",3000);assertNotNull(lease);
        assertTrue(store.prepare(lease,"HTTP_POST_STARTED"));
        context.getBean(org.springframework.jdbc.core.JdbcTemplate.class).update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",lease.job().taskRunId());
        drain(id);assertEquals(before,posts.get());assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());
        assertTrue(executions().get(actor,"lab",id).error().contains("unknown"));
    }
    @Test void postExecutesOnceAndTimeoutDoesNotAutomaticallyRetry() {
        int before=posts.get();String id=submit(http("POST","/ok","PT3S"));drain(id);assertEquals(before+1,posts.get());assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
        id=submit(http("POST","/slow","PT0.3S"));drain(id);assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());assertEquals(before+2,posts.get());
    }
    @Test void sqlPreparedParametersReturnActualRowsAndNulls() {
        String id=submit("""
                tasks:
                  - id: query
                    type: core.Sql
                    timeout: PT3S
                    sql:
                      connection: business
                      query: 'SELECT ? AS value, NULL AS absent'
                      parameters: [{source: LITERAL, value: 7}]
                outputs:
                  rows: {source: TASK_OUTPUT, taskId: query, port: rows}
                """);drain(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
        var row=(Map<?,?>)((List<?>)executions().get(actor,"lab",id).outputs().get("rows")).getFirst();assertEquals(7,((Number)row.get("value")).intValue());assertTrue(row.containsKey("absent"));assertNull(row.get("absent"));
    }
    @Test void sqlFailureAndTimeoutDoNotProduceRows() {
        for(String query:List.of("SELECT missing FROM missing_table","SELECT SLEEP(5)")) {
            String id=submit("tasks: [{id: query, type: core.Sql, timeout: PT0.5S, sql: {connection: business, query: '"+query+"'}}]\n");
            drain(id);assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());assertTrue(executions().get(actor,"lab",id).outputs().isEmpty());
        }
    }
}

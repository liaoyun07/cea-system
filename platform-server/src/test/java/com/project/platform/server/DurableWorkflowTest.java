package com.project.platform.server;

import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.dataflow.execution.FlowExecutionService.Request;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.executor.FlowExecutor;
import com.project.platform.runtime.model.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.resource.catalog.ResourceException;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.deployment.application.*;
import com.project.platform.deployment.application.ApplicationVersion.*;
import java.net.URI;
import java.net.ServerSocket;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataAccessException;
import org.testcontainers.containers.MySQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class DurableWorkflowTest {
    @Test void outputDeclarationsUsePinnedExecutionAcrossUserAndPolicyScopes() throws Exception {
        var outputs=context.getBean(com.project.platform.dataflow.execution.ExecutionOutputService.class);
        for(boolean policy:List.of(false,true)) {
            String flowId=id();
            String source="schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\ntasks:\n  - id: items\n    type: core.Loop\n    loop: {values: {source: LITERAL, value: [1]}, concurrency: 1}\n    tasks:\n      - id: work\n        type: platform.Application\n        timeout: PT60S\n        container: {applicationId: fixture, version: v1, candidateClusters: [edge], command: [echo, fixture], outputFiles: [report.json, model.pt]}\n";
            if(policy) flows().savePolicy(actor,"lab",flowId,0,source); else flows().save(actor,"lab",flowId,0,source);
            var request=new Request(flowId,1,Map.of());
            String executionId=policy?executions().submitPolicy(actor,"lab",id(),request):executions().submit(actor,"lab",id(),request);
            try {
                String changed="schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\ntasks: [{id: other, type: core.Log, message: changed}]";
                if(policy) flows().savePolicy(actor,"lab",flowId,1,changed); else flows().save(actor,"lab",flowId,1,changed);
                if(policy) assertThrows(WorkflowException.class,()->flows().get(actor,"lab",flowId,1));
                var declarations=outputs.declarations(new Actor("viewer",Set.of("lab"),Set.of(Action.READ)),"lab",executionId);
                assertEquals(List.of(new com.project.platform.dataflow.execution.ExecutionOutputService.OutputSource("work",List.of("report.json","model.pt"))),declarations);
                String url="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab/executions/"+executionId+"/output-files";
                String auth="Basic "+Base64.getEncoder().encodeToString("viewer:test-password".getBytes(StandardCharsets.UTF_8));
                assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(url)).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
                var response=http.send(HttpRequest.newBuilder(URI.create(url)).header("Authorization",auth).build(),HttpResponse.BodyHandlers.ofString());
                assertEquals(200,response.statusCode());assertEquals(json.write(declarations),response.body());
                assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(url.replace("/lab/","/other/"))).header("Authorization",auth).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
            } finally {
                jdbc().update("DELETE FROM wf_message WHERE execution_id=?",executionId);
                jdbc().update("DELETE FROM wf_task_run WHERE execution_id=?",executionId);
                jdbc().update("DELETE FROM wf_execution WHERE id=?",executionId);
            }
        }
    }
    @Test void overviewCountsEntireUtcWindowInsteadOfListPageAndEnforcesRead() throws Exception {
        String namespace="overview"+UUID.randomUUID().toString().replace("-","");
        var owner=new Actor("writer",Set.of(namespace),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
        flows().save(owner,namespace,"summary",0,"schemaVersion: 1\nnamespace: "+namespace+"\nid: summary\ntasks: [{id: log, type: core.Log, message: fixture}]");
        var ids=new ArrayList<String>();
        try {
        for(int i=0;i<125;i++) ids.add(executions().submit(owner,namespace,UUID.randomUUID().toString(),new Request("summary",null,Map.of())));
        var before=executions().overview(owner,namespace,1);
        jdbc().update("UPDATE wf_execution SET created_at=? WHERE id=?",java.sql.Timestamp.from(before.from().minusSeconds(1)),ids.get(0));
        jdbc().update("UPDATE wf_execution SET created_at=? WHERE id=?",java.sql.Timestamp.from(before.to().plusSeconds(86400)),ids.get(1));
        jdbc().update("UPDATE wf_execution SET created_at=? WHERE id=?",java.sql.Timestamp.from(before.from()),ids.get(2));
        jdbc().update("UPDATE wf_execution SET state='SUCCESS' WHERE id=?",ids.get(3));
        jdbc().update("UPDATE wf_execution SET state='FAILED' WHERE id=?",ids.get(4));
        jdbc().update("UPDATE wf_execution SET state='KILLED' WHERE id=?",ids.get(5));
        var result=executions().overview(owner,namespace,1);
        assertEquals(123,result.days().stream().mapToLong(row->row.count()).sum());
        assertEquals(10,result.recent().size());
        assertTrue(result.recent().stream().noneMatch(row->row.id().equals(ids.get(0)) || row.id().equals(ids.get(1))));
        assertEquals(1,result.days().stream().filter(row->row.state()==ExecutionState.FAILED).findFirst().orElseThrow().count());
        assertEquals(1,result.days().stream().filter(row->row.state()==ExecutionState.KILLED).findFirst().orElseThrow().count());
        assertTrue(result.days().stream().allMatch(row->row.date().equals(result.from().toString().substring(0,10))));
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->executions().overview(actor,namespace,1));
        assertThrows(WorkflowException.class,()->executions().overview(owner,namespace,32));
        var empty=new Actor("reader",Set.of("emptyoverview"),Set.of(Action.READ));
        assertTrue(executions().overview(empty,"emptyoverview",7).days().isEmpty());
        String base="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab/executions/overview";
        String auth="Basic "+Base64.getEncoder().encodeToString("viewer:test-password".getBytes(StandardCharsets.UTF_8));
        assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base)).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(base)).header("Authorization",auth).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        assertEquals(422,http.send(HttpRequest.newBuilder(URI.create(base+"?days=0")).header("Authorization",auth).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base.replace("/lab/","/other/"))).header("Authorization",auth).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        } finally {
            jdbc().update("DELETE FROM wf_message WHERE execution_id IN (SELECT id FROM wf_execution WHERE namespace=?)",namespace);
            jdbc().update("DELETE FROM wf_task_run WHERE execution_id IN (SELECT id FROM wf_execution WHERE namespace=?)",namespace);
            jdbc().update("DELETE FROM wf_execution WHERE namespace=?",namespace);
        }
    }
    private final MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0")
            .withCommand("--log-bin-trust-function-creators=1")
            .withDatabaseName("backend_s1_test").withUsername("backend_test").withPassword("isolated-test-only")
            .withUrlParam("connectionTimeZone","UTC");
    private ConfigurableApplicationContext context;
    private final JsonCodec json = new JsonCodec();
    private final Actor actor = new Actor("writer",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    @BeforeAll void start() {
        mysql.start();
        try { context = open(); }
        catch (RuntimeException ex) { mysql.stop(); throw ex; }
    }
    @AfterAll void stop() {
        if (context != null) context.close();
        mysql.stop();
    }
    private ConfigurableApplicationContext open() {
        return new SpringApplicationBuilder(BackendApplication.class).run(
                "--server.port=0","--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false",
                "--spring.datasource.url="+mysql.getJdbcUrl(),
                "--spring.datasource.username="+mysql.getUsername(),
                "--spring.datasource.password="+mysql.getPassword(),
                "--platform.security.users[0].name=writer","--platform.security.users[0].password=test-password",
                "--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE",
                "--platform.security.users[1].name=viewer","--platform.security.users[1].password=test-password",
                "--platform.security.users[1].namespaces=lab","--platform.security.users[1].actions=READ",
                "--logging.level.root=WARN");
    }
    private FlowService flows() { return context.getBean(FlowService.class); }
    private FlowExecutionService executions() { return context.getBean(FlowExecutionService.class); }
    private JdbcTemplate jdbc() { return context.getBean(JdbcTemplate.class); }
    private com.project.platform.runtime.worker.WorkerEngine worker() { return context.getBean(com.project.platform.runtime.worker.WorkerEngine.class); }
    private com.project.platform.runtime.persistence.JdbcWorkerStore jobs() { return context.getBean(com.project.platform.runtime.persistence.JdbcWorkerStore.class); }
    private void pause(long ms) { try { Thread.sleep(ms); } catch(InterruptedException ex) { Thread.currentThread().interrupt(); throw new IllegalStateException(ex); } }
    private FlowExecutor executor() { return context.getBean(FlowExecutor.class); }
    private String id() { return "f"+UUID.randomUUID().toString().replace("-",""); }
    private String source(String id) {
        return """
                schemaVersion: 1
                namespace: lab
                id: %s
                inputs:
                  name: {type: STRING, required: true}
                  count: {type: INTEGER, defaultValue: 2}
                variables:
                  greeting: {source: LITERAL, value: Hello}
                tasks:
                  - {id: first, type: core.Log, message: "{{ vars.greeting }} {{ inputs.name }}"}
                  - {id: second, type: core.Log, message: "{{ outputs.first.message }}; count={{ inputs.count }}"}
                outputs:
                  result: {source: TASK_OUTPUT, taskId: second, port: message}
                  count: {source: INPUT, name: count}
                """.formatted(id);
    }
    private String register() {
        String id=id(); flows().save(actor,"lab",id,0,source(id)); return id;
    }
    private Request request(String id) { return new Request(id,null,Map.of("name","Ada")); }
    private void drain() {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(20);
        while(System.nanoTime()<deadline) {
            executor().processNext();
            worker().runOnce();
            if(jdbc().queryForObject("SELECT COUNT(*) FROM wf_message",Integer.class)==0) return;
            pause(25);
        }
        fail("executor/worker did not drain");
    }

    @Test void realMysqlAndFlywayMigrations() {
        assertTrue(jdbc().queryForObject("SELECT VERSION()",String.class).startsWith("8.0."));
        assertEquals(19,jdbc().queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE success=1",Integer.class));
        assertEquals(3,jdbc().queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('res_terminal_reservation','off_task_observation','off_dqn_model')",Integer.class));
    }
    @Test void immutableRevisionsAndRollback() {
        String id=register();
        String original=flows().get(actor,"lab",id,1).source();
        flows().save(actor,"lab",id,1,source(id).replace("Hello","Welcome"));
        assertEquals(original,flows().get(actor,"lab",id,1).source());
        assertEquals(3,flows().rollback(actor,"lab",id,2,1).revision());
        assertEquals(original,flows().get(actor,"lab",id,null).source());
        assertThrows(WorkflowException.class,()->flows().save(actor,"lab",id,1,source(id)));
        assertEquals(3,flows().history(actor,"lab",id,20,0).size());
    }
    @Test void concurrentRevisionCompareAndSetHasOneWinner() throws Exception {
        String id=register();
        try(var pool=Executors.newFixedThreadPool(6)) {
            var jobs=new ArrayList<Callable<Boolean>>();
            for(int i=0;i<6;i++) jobs.add(()->{
                try { flows().save(actor,"lab",id,1,source(id)); return true; }
                catch(WorkflowException ex) { assertEquals(WorkflowException.Kind.CONFLICT,ex.kind()); return false; }
            });
            int winners=0; for(var future:pool.invokeAll(jobs)) if(future.get()) winners++;
            assertEquals(1,winners);
        }
        assertEquals(2,flows().get(actor,"lab",id,null).revision());
    }
    @Test void concurrentIdempotencyProducesOneExecution() throws Exception {
        String id=register(), key=id();
        Set<String> executionIds=new HashSet<>();
        try(var pool=Executors.newFixedThreadPool(8)) {
            var jobs=new ArrayList<Callable<String>>();
            for(int i=0;i<12;i++) jobs.add(()->executions().submit(actor,"lab",key,request(id)));
            for(var future:pool.invokeAll(jobs)) executionIds.add(future.get());
        }
        assertEquals(1,executionIds.size());
        String executionId=executionIds.iterator().next();
        assertEquals(2,executions().tasks(actor,"lab",executionId).size());
        assertThrows(WorkflowException.class,()->executions().submit(actor,"lab",key,new Request(id,null,Map.of("name","Different"))));
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
    }
    @Test void acceptedRequestKeepsRevisionDefaultsAndTypedOutputsAfterEdit() {
        String id=register(),key=id();
        String executionId=executions().submit(actor,"lab",key,request(id));
        flows().save(actor,"lab",id,1,source(id).replace("Hello","Changed").replace("defaultValue: 2","defaultValue: 9"));
        assertEquals(executionId,executions().submit(actor,"lab",key,request(id)));
        drain();
        var execution=executions().get(actor,"lab",executionId);
        assertEquals(1,execution.flowRevision());
        assertEquals(2,execution.outputs().get("count"));
        assertEquals("Hello Ada; count=2",execution.outputs().get("result"));
        assertNotNull(execution.startedAt()); assertNotNull(execution.endedAt());
        var tasks=executions().tasks(actor,"lab",executionId);
        assertTrue(tasks.getFirst().endedAt().compareTo(tasks.getLast().startedAt())<=0);
        assertEquals(2,executions().logs(actor,"lab",executionId,0,50).size());
        assertEquals(1,executions().attempts(actor,"lab",executionId,tasks.getFirst().id()).size());
    }
    @Test void failureIsPersistedAndRemainingTasksAreSkipped() {
        String id=id();
        flows().save(actor,"lab",id,0,source(id).replace("{{ vars.greeting }}","{{ inputs.missing }}"));
        String executionId=executions().submit(actor,"lab",id(),request(id));
        drain();
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",executionId).state());
        var tasks=executions().tasks(actor,"lab",executionId);
        assertEquals(ExecutionState.FAILED,tasks.getFirst().state());
        assertEquals(ExecutionState.SKIPPED,tasks.getLast().state());
        assertEquals("ERROR",executions().logs(actor,"lab",executionId,0,50).getFirst().level());
    }
    @Test void submissionRollsBackIfQueueInsertFails() {
        String id=register(),key=id();
        jdbc().execute("CREATE TRIGGER fail_s1_message BEFORE INSERT ON wf_message FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected queue failure'");
        try {
            assertThrows(DataAccessException.class,()->executions().submit(actor,"lab",key,request(id)));
            assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE request_key=?",Integer.class,key));
        } finally { jdbc().execute("DROP TRIGGER fail_s1_message"); }
    }
    @Test void logStateAndNextMessageRollBackTogether() {
        drain();
        String id=register(),executionId=executions().submit(actor,"lab",id(),request(id));
        assertTrue(executor().processNext()); // execution RUNNING
        assertTrue(executor().processNext()); // first task RUNNING and Worker job dispatched
        assertTrue(worker().runOnce());
        pause(150);
        jdbc().execute("CREATE TRIGGER fail_s1_message BEFORE INSERT ON wf_message FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected queue failure'");
        try {
            assertThrows(DataAccessException.class,()->executor().processNext());
            assertEquals(0,executions().logs(actor,"lab",executionId,0,50).size());
            assertEquals(ExecutionState.RUNNING,executions().tasks(actor,"lab",executionId).getFirst().state());
            assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM wf_message WHERE execution_id=?",Integer.class,executionId));
            assertNotNull(jobs().result(first(executionId).id(),1));
        } finally { jdbc().execute("DROP TRIGGER fail_s1_message"); }
        drain();
        assertEquals(2,executions().logs(actor,"lab",executionId,0,50).size());
    }
    @Test void multipleConsumersDoNotDuplicateLogsOrAttempts() throws Exception {
        String id=register(),executionId=executions().submit(actor,"lab",id(),request(id));
        try(var pool=Executors.newFixedThreadPool(4)) {
            var jobs=new ArrayList<Callable<Void>>();
            for(int i=0;i<4;i++) jobs.add(()->{ drain(); return null; });
            for(var future:pool.invokeAll(jobs)) future.get();
        }
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
        assertEquals(2,executions().logs(actor,"lab",executionId,0,50).size());
        for(var task:executions().tasks(actor,"lab",executionId))
            assertEquals(1,executions().attempts(actor,"lab",executionId,task.id()).size());
    }
    @Test void contextRestartResumesRunningTask() {
        drain();
        String id=register(),executionId=executions().submit(actor,"lab",id(),request(id));
        executor().processNext(); executor().processNext();
        String firstTask=executions().tasks(actor,"lab",executionId).getFirst().id();
        context.close(); context=open();
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
        assertEquals(firstTask,executions().tasks(actor,"lab",executionId).getFirst().id());
        assertEquals(1,executions().attempts(actor,"lab",executionId,firstTask).size());
    }

    private int port() { return Integer.parseInt(context.getBean(Environment.class).getProperty("local.server.port")); }
    private HttpResponse<String> call(int port,String method,String path,String user,Object body,String key) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(5));
        if(user!=null) builder.header("Authorization","Basic "+Base64.getEncoder().encodeToString((user+":test-password").getBytes(StandardCharsets.UTF_8)));
        if(key!=null) builder.header("Idempotency-Key",key);
        builder.header("X-User","writer");
        if(body!=null) builder.header("Content-Type","application/json");
        builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.write(body)));
        return http.send(builder.build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void httpContractAndNamespacePermissions() throws Exception {
        String id=id(),base="/api/namespaces/lab";
        assertEquals(401,call(port(),"GET",base+"/flows",null,null,null).statusCode());
        assertEquals(403,call(port(),"GET","/api/namespaces/other/flows","writer",null,null).statusCode());
        var body=Map.of("expectedRevision",0,"source",source(id));
        assertEquals(403,call(port(),"POST",base+"/flows/"+id+"/revisions","viewer",body,null).statusCode());
        assertEquals(201,call(port(),"POST",base+"/flows/"+id+"/revisions","writer",body,null).statusCode());
        assertEquals(409,call(port(),"POST",base+"/flows/"+id+"/revisions","writer",body,null).statusCode());
        assertEquals(422,call(port(),"POST",base+"/executions","writer",new Request(id,null,Map.of()),id()).statusCode());
        assertEquals(400,call(port(),"POST",base+"/executions","writer",request(id),null).statusCode());
        var accepted=call(port(),"POST",base+"/executions","writer",request(id),id());
        assertEquals(202,accepted.statusCode(),accepted.body());
        String executionId=(String)json.map(accepted.body()).get("executionId");
        drain();
        assertEquals(200,call(port(),"GET",base+"/executions/"+executionId,"viewer",null,null).statusCode());
        assertEquals(403,call(port(),"GET","/api/namespaces/other/executions/"+executionId+"/logs","writer",null,null).statusCode());
        assertEquals(200,call(port(),"GET",base+"/executions/"+executionId+"/logs","viewer",null,null).statusCode());
        assertEquals(422,call(port(),"GET",base+"/executions?limit=1000","writer",null,null).statusCode());
    }

    @Test void forcedJvmRestartKeepsAnAcceptedExecution() throws Exception {
        String flowId=register();
        int childPort;
        try(var socket=new ServerSocket(0)) { childPort=socket.getLocalPort(); }
        Process child=null;
        String executionId;
        try {
            child=startChild(childPort,false,"before");
            awaitChild(child,childPort);
            var accepted=call(childPort,"POST","/api/namespaces/lab/executions","writer",request(flowId),id());
            assertEquals(202,accepted.statusCode(),accepted.body());
            executionId=(String)json.map(accepted.body()).get("executionId");
            assertEquals(ExecutionState.CREATED,executions().get(actor,"lab",executionId).state());
            child.destroyForcibly();
            assertTrue(child.waitFor(10,TimeUnit.SECONDS));
            child=startChild(childPort,true,"after");
            awaitChild(child,childPort);
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(20);
            while(System.nanoTime()<deadline && !executions().get(actor,"lab",executionId).state().terminal()) Thread.sleep(100);
            assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
            assertEquals(2,executions().logs(actor,"lab",executionId,0,50).size());
        } finally {
            if(child!=null && child.isAlive()) { child.destroyForcibly(); child.waitFor(10,TimeUnit.SECONDS); }
        }
    }
    private Process startChild(int port,boolean executorEnabled,String suffix) throws Exception {
        return startChild(port,executorEnabled,executorEnabled,suffix);
    }
    private Process startChild(int port,boolean executorEnabled,boolean workerEnabled,String suffix) throws Exception {
        return startChild(port,executorEnabled,workerEnabled,false,suffix);
    }
    private Process startChild(int port,boolean executorEnabled,boolean workerEnabled,boolean schedulerEnabled,String suffix) throws Exception {
        String java=Path.of(System.getProperty("java.home"),"bin",System.getProperty("os.name").startsWith("Windows")?"java.exe":"java").toString();
        String classpath=System.getProperty("surefire.test.class.path",System.getProperty("java.class.path"));
        var command=new ArrayList<>(List.of(java,"-cp",classpath,BackendApplication.class.getName(),
                "--server.port="+port,"--platform.executor.enabled="+executorEnabled,"--platform.worker.enabled="+workerEnabled,"--platform.scheduler.enabled="+schedulerEnabled,"--platform.worker.lease-ms=600",
                "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),
                "--spring.datasource.password="+mysql.getPassword(),
                "--platform.security.users[0].name=writer","--platform.security.users[0].password=test-password",
                "--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE",
                "--logging.level.root=WARN"));
        Files.createDirectories(Path.of("target","restart-evidence"));
        return new ProcessBuilder(command).redirectErrorStream(true)
                .redirectOutput(Path.of("target","restart-evidence",suffix+".log").toFile()).start();
    }
private String custom(String body) {
        String flowId=id();
        flows().save(actor,"lab",flowId,0,"schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\ninputs:\n  name: {type: STRING}\n"+body);
        return executions().submit(actor,"lab",id(),request(flowId));
    }
    private String dispatchCustom(String body) {
        drain();
        String executionId=custom(body);
        assertTrue(executor().processNext());
        assertTrue(executor().processNext());
        return executionId;
    }
    private void advanceUntil(java.util.function.BooleanSupplier condition) {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(20);
        while(System.nanoTime()<deadline) {
            if(condition.getAsBoolean()) return;
            executor().processNext();
            pause(15);
        }
        fail("executor condition timed out");
    }
    private ExecutionRecord.TaskRun first(String executionId) { return executions().tasks(actor,"lab",executionId).getFirst(); }

    @Test void leaseTakeoverKeepsAttemptAndRejectsOldAndDuplicateResults() {
        String executionId=dispatchCustom("tasks: [{id: one, type: core.Log, message: real}]\n");
        var old=jobs().claim("old-worker",300);
        assertNotNull(old);
        assertTrue(jobs().heartbeat(old,300));
        jdbc().update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",old.job().taskRunId());
        assertFalse(jobs().heartbeat(old,300));
        var replacement=jobs().claim("new-worker",3000);
        assertEquals(old.job().attemptNo(),replacement.job().attemptNo());
        assertEquals(old.epoch()+1,replacement.epoch());
        assertFalse(jobs().finish(old,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","stale"))));
        var result=com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","real"));
        assertTrue(jobs().finish(replacement,result));
        assertFalse(jobs().finish(replacement,result));
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
        assertEquals("real",executions().logs(actor,"lab",executionId,0,50).getFirst().message());
        assertEquals(1,executions().attempts(actor,"lab",executionId,first(executionId).id()).size());
    }

    @Test void savedWorkerResultSurvivesRestartBeforeMerge() {
        String executionId=dispatchCustom("tasks: [{id: one, type: core.Log, message: durable}]\n");
        assertTrue(worker().runOnce());
        assertEquals(ExecutionState.RUNNING,first(executionId).state());
        assertTrue(executions().logs(actor,"lab",executionId,0,50).isEmpty());
        context.close(); context=open();
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
        assertEquals(1,executions().logs(actor,"lab",executionId,0,50).size());
    }

    @Test void constantRetryWaitIsDurableAndMaxAttemptsIncludesFirst() {
        String executionId=dispatchCustom("""
                tasks:
                  - id: one
                    type: core.Log
                    message: "{{ taskrun.attemptsCount == 1 ? missing : 'recovered' }}"
                    retry: {type: constant, maxAttempts: 2, interval: PT1S}
                """);
        worker().runOnce();
        advanceUntil(()->first(executionId).state()==ExecutionState.RETRYING);
        var at=first(executionId).retryAt();
        jdbc().update("UPDATE wf_message SET available_at=CURRENT_TIMESTAMP(6) WHERE execution_id=?",executionId);
        executor().processNext();
        assertEquals(1,executions().attempts(actor,"lab",executionId,first(executionId).id()).size());
        context.close(); context=open();
        assertEquals(at,first(executionId).retryAt());
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
        var attempts=executions().attempts(actor,"lab",executionId,first(executionId).id());
        assertEquals(2,attempts.size());
        assertEquals(ExecutionState.FAILED,attempts.getFirst().state());
        assertEquals(ExecutionState.SUCCESS,attempts.getLast().state());
        assertFalse(attempts.getLast().startedAt().isBefore(at));
        assertEquals("recovered",executions().logs(actor,"lab",executionId,0,50).getLast().message());
    }

    @Test void exhaustedRetriesRunErrorsAndFinallyAndKeepPrimaryFailure() {
        String executionId=custom("""
                tasks:
                  - {id: bad, type: core.Log, message: "{{ missing }}", retry: {type: constant, maxAttempts: 2, interval: PT0.01S}}
                  - {id: skipped, type: core.Log, message: never}
                errors:
                  - {id: handler, type: core.Log, message: handled}
                finally:
                  - {id: cleanup, type: core.Log, message: cleaned}
                """);
        drain();
        var e=executions().get(actor,"lab",executionId);
        assertEquals(ExecutionState.FAILED,e.state());
        assertEquals(ExecutionState.FAILED,e.mainState());
        assertNotNull(e.error());
        assertNull(e.cleanupError());
        assertEquals(2,executions().attempts(actor,"lab",executionId,first(executionId).id()).size());
        assertEquals(List.of(ExecutionState.FAILED,ExecutionState.SKIPPED,ExecutionState.SUCCESS,ExecutionState.SUCCESS),
                executions().tasks(actor,"lab",executionId).stream().map(ExecutionRecord.TaskRun::state).toList());
    }

    @Test void handlerAndCleanupFailuresNeverOverwriteMainFailure() {
        String executionId=custom("""
                tasks: [{id: main, type: core.Log, message: "{{ missing }}"}]
                errors:
                  - {id: handler, type: core.Log, message: "{{ missing }}"}
                  - {id: skippedHandler, type: core.Log, message: never}
                finally:
                  - {id: badCleanup, type: core.Log, message: "{{ missing }}"}
                  - {id: cleanup, type: core.Log, message: always}
                """);
        drain();
        var e=executions().get(actor,"lab",executionId);
        assertEquals(ExecutionState.FAILED,e.mainState());
        assertNotNull(e.error()); assertNotNull(e.cleanupError());
        var tasks=executions().tasks(actor,"lab",executionId);
        assertEquals(ExecutionState.FAILED,tasks.get(1).state());
        assertEquals(ExecutionState.SKIPPED,tasks.get(2).state());
        assertEquals(ExecutionState.FAILED,tasks.get(3).state());
        assertEquals(ExecutionState.SUCCESS,tasks.getLast().state());
    }

    @Test void successfulMainSkipsErrorsAndCleanupFailureIsSeparate() {
        String executionId=custom("""
                tasks: [{id: main, type: core.Log, message: success}]
                errors: [{id: handler, type: core.Log, message: never}]
                finally: [{id: cleanup, type: core.Log, message: "{{ missing }}"}]
                outputs: {result: {source: TASK_OUTPUT, taskId: main, port: message}}
                """);
        drain();
        var e=executions().get(actor,"lab",executionId);
        assertEquals(ExecutionState.FAILED,e.state());
        assertEquals(ExecutionState.SUCCESS,e.mainState());
        assertNull(e.error()); assertNotNull(e.cleanupError());
        assertEquals("success",e.outputs().get("result"));
        assertEquals(ExecutionState.SKIPPED,executions().tasks(actor,"lab",executionId).get(1).state());
    }

    @Test void timeoutWithoutAvailableWorkerTerminatesAndRetriesOnlyConfiguredCount() {
        String executionId=dispatchCustom("""
                tasks: [{id: delayed, type: core.Sleep, duration: PT5S, timeout: PT0.15S, retry: {type: constant, maxAttempts: 2, interval: PT0.01S}}]
                """);
        advanceUntil(()->executions().get(actor,"lab",executionId).state().terminal());
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",executionId).state());
        assertEquals("attempt timed out",executions().get(actor,"lab",executionId).error());
        assertEquals(2,executions().attempts(actor,"lab",executionId,first(executionId).id()).size());
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_worker_job",Integer.class));
    }

    @Test void longSleepHeartbeatsWithoutOpeningAdditionalAttempt() throws Exception {
        String executionId=dispatchCustom("tasks: [{id: sleep, type: core.Sleep, duration: PT0.9S}]\n");
        try(var shortLeaseWorker=new com.project.platform.runtime.worker.WorkerEngine(jobs(),context.getBean(com.project.platform.runtime.definition.TemplateRenderer.class),300,context.getBean(com.project.platform.runtime.worker.TaskRunner.class));
            var pool=Executors.newSingleThreadExecutor()) {
            var running=pool.submit(shortLeaseWorker::runOnce);
            pause(450);
            assertNull(jobs().claim("competitor",300));
            assertTrue(running.get(3,TimeUnit.SECONDS));
        }
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
        assertEquals(1,executions().attempts(actor,"lab",executionId,first(executionId).id()).size());
    }

    @Test void runningTaskCancellationStopsWorkerSkipsErrorsAndRunsFinally() throws Exception {
        String executionId=dispatchCustom("""
                tasks:
                  - {id: sleep, type: core.Sleep, duration: PT5S, retry: {type: constant, maxAttempts: 3, interval: PT0.01S}}
                  - {id: unused, type: core.Log, message: never}
                errors: [{id: handler, type: core.Log, message: never}]
                finally: [{id: cleanup, type: core.Log, message: cleaned}]
                """);
        try(var pool=Executors.newSingleThreadExecutor()) {
            var running=pool.submit(worker()::runOnce);
            advanceUntil(()->jdbc().queryForObject("SELECT COUNT(*) FROM wf_worker_job WHERE state='RUNNING'",Integer.class)>0);
            executions().cancel(actor,"lab",executionId);
            executions().cancel(actor,"lab",executionId);
            advanceUntil(()->first(executionId).state()==ExecutionState.KILLED);
            assertTrue(running.get(3,TimeUnit.SECONDS));
        }
        drain();
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",executionId).state());
        var tasks=executions().tasks(actor,"lab",executionId);
        assertEquals(1,executions().attempts(actor,"lab",executionId,tasks.getFirst().id()).size());
        assertEquals(ExecutionState.SKIPPED,tasks.get(2).state());
        assertEquals(ExecutionState.SUCCESS,tasks.getLast().state());
        executions().cancel(actor,"lab",executionId);
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_message WHERE execution_id=?",Integer.class,executionId));
    }

    @Test void cancelWhileWaitingForRetryDoesNotRewriteFailedAttempt() {
        String executionId=dispatchCustom("""
                tasks: [{id: bad, type: core.Log, message: "{{ missing }}", retry: {type: constant, maxAttempts: 3, interval: PT10S}}]
                finally: [{id: cleanup, type: core.Log, message: done}]
                """);
        worker().runOnce();
        advanceUntil(()->first(executionId).state()==ExecutionState.RETRYING);
        executions().cancel(actor,"lab",executionId);
        drain();
        var attempts=executions().attempts(actor,"lab",executionId,first(executionId).id());
        assertEquals(1,attempts.size());
        assertEquals(ExecutionState.FAILED,attempts.getFirst().state());
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",executionId).state());
    }

    @Test void cancellationDuringFinallyPreservesItsRetryAndDoesNotRepeatCleanup() {
        String executionId=dispatchCustom("""
                tasks: [{id: main, type: core.Log, message: done}]
                finally:
                  - id: cleanup
                    type: core.Log
                    message: "{{ taskrun.attemptsCount == 1 ? missing : 'cleaned' }}"
                    retry: {type: constant, maxAttempts: 2, interval: PT0.2S}
                """);
        worker().runOnce();
        advanceUntil(()->executions().tasks(actor,"lab",executionId).getLast().state()==ExecutionState.RUNNING);
        worker().runOnce();
        advanceUntil(()->executions().tasks(actor,"lab",executionId).getLast().state()==ExecutionState.RETRYING);
        executions().cancel(actor,"lab",executionId);
        drain();
        var tasks=executions().tasks(actor,"lab",executionId);
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",executionId).state());
        assertEquals(ExecutionState.SUCCESS,tasks.getLast().state());
        assertEquals(List.of(ExecutionState.FAILED,ExecutionState.SUCCESS),
                executions().attempts(actor,"lab",executionId,tasks.getLast().id()).stream().map(ExecutionRecord.Attempt::state).toList());
        assertEquals(1,executions().attempts(actor,"lab",executionId,tasks.getFirst().id()).size());
        assertNull(executions().get(actor,"lab",executionId).cleanupError());
    }

    @Test void cancellationWinsOverUnmergedResultAndRejectsLateCallback() {
        String executionId=dispatchCustom("tasks: [{id: main, type: core.Log, message: result}]\n");
        var lease=jobs().claim("worker",3000);
        assertTrue(jobs().finish(lease,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","result"))));
        executions().cancel(actor,"lab",executionId);
        drain();
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",executionId).state());
        assertTrue(executions().logs(actor,"lab",executionId,0,50).isEmpty());
        assertFalse(jobs().finish(lease,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","late"))));
    }

    @Test void cancelEndpointEnforcesExecutePermission() throws Exception {
        String executionId=custom("tasks: [{id: main, type: core.Log, message: test}]\n");
        String path="/api/namespaces/lab/executions/"+executionId+"/cancel";
        assertEquals(401,call(port(),"POST",path,null,null,null).statusCode());
        assertEquals(403,call(port(),"POST",path,"viewer",null,null).statusCode());
        assertEquals(202,call(port(),"POST",path,"writer",null,null).statusCode());
        assertEquals(202,call(port(),"POST",path,"writer",null,null).statusCode());
        drain();
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",executionId).state());
        assertTrue(executions().attempts(actor,"lab",executionId,first(executionId).id()).isEmpty());
    }

    @Test void forceKilledWorkerJvmIsReclaimedWithoutBusinessRetry() throws Exception {
        String executionId=dispatchCustom("tasks: [{id: sleep, type: core.Sleep, duration: PT5S}]\n");
        String taskRunId=first(executionId).id();
        int childPort;
        try(var socket=new ServerSocket(0)) { childPort=socket.getLocalPort(); }
        Process child=null;
        try {
            child=startChild(childPort,false,true,"worker-before");
            awaitChild(child,childPort);
            advanceUntil(()->jdbc().queryForObject("SELECT COUNT(*) FROM wf_worker_job WHERE task_run_id=? AND state='RUNNING'",Integer.class,taskRunId)==1);
            long oldEpoch=jdbc().queryForObject("SELECT epoch FROM wf_worker_job WHERE task_run_id=?",Long.class,taskRunId);
            child.destroyForcibly(); assertTrue(child.waitFor(10,TimeUnit.SECONDS));
            child=startChild(childPort,false,true,"worker-after");
            awaitChild(child,childPort);
            advanceUntil(()->jdbc().queryForObject("SELECT epoch FROM wf_worker_job WHERE task_run_id=?",Long.class,taskRunId)>oldEpoch);
            advanceUntil(()->executions().get(actor,"lab",executionId).state().terminal());
            assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
            assertEquals(taskRunId,first(executionId).id());
            assertEquals(1,executions().attempts(actor,"lab",executionId,taskRunId).size());
        } finally {
            if(child!=null && child.isAlive()) { child.destroyForcibly(); child.waitFor(10,TimeUnit.SECONDS); }
        }
    }
    @Test void acceptedResultBeforeDeadlineIsNotTimedOutByLateMerge() {
        String executionId=dispatchCustom("tasks: [{id: one, type: core.Log, message: done, timeout: PT0.5S}]\n");
        assertTrue(worker().runOnce());
        pause(600);
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
    }

    @Test void activeSleepTimeoutStopsWorkerAndRunsCleanup() throws Exception {
        String executionId=dispatchCustom("tasks: [{id: sleep, type: core.Sleep, duration: PT5S, timeout: PT0.25S}]\nfinally: [{id: cleanup, type: core.Log, message: timeout-cleanup}]\n");
        try(var pool=Executors.newSingleThreadExecutor()) {
            var running=pool.submit(worker()::runOnce);
            advanceUntil(()->first(executionId).state()==ExecutionState.FAILED);
            assertTrue(running.get(3,TimeUnit.SECONDS));
        }
        drain();
        assertEquals("attempt timed out",executions().get(actor,"lab",executionId).error());
        assertEquals(ExecutionState.SUCCESS,executions().tasks(actor,"lab",executionId).getLast().state());
    }

    @Test void migrationRejectsActiveS1AndPreservesCompletedHistory() throws Exception {
        // A second schema in this test's disposable container, never the application's configured database.
        var created=mysql.execInContainer("mysql","-uroot","-p"+mysql.getPassword(),"-e",
                "CREATE DATABASE s2_upgrade_test; GRANT ALL ON s2_upgrade_test.* TO 'backend_test'@'%';");
        assertEquals(0,created.getExitCode(),created.getStderr());
        String url=mysql.getJdbcUrl().replace("/backend_s1_test","/s2_upgrade_test");
        var initial=org.flywaydb.core.Flyway.configure().dataSource(url,mysql.getUsername(),mysql.getPassword())
                .locations("classpath:db/migration/runtime","classpath:db/migration/dataflow").target("2").load();
        initial.migrate();
        var oldDb=new JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(url,mysql.getUsername(),mysql.getPassword()));
        oldDb.update("INSERT INTO wf_execution(id,namespace,flow_id,flow_revision,submitted_by,request_key,request_hash,state,definition_json,inputs_json,variables_json,outputs_json,created_at) VALUES('s1-history','lab','old',1,'writer','old-key',?,'RUNNING','{}','{}','{}','{}',CURRENT_TIMESTAMP(6))","a".repeat(64));
        var upgrade=org.flywaydb.core.Flyway.configure().dataSource(url,mysql.getUsername(),mysql.getPassword())
                .locations("classpath:db/migration/runtime","classpath:db/migration/dataflow").load();
        assertThrows(org.flywaydb.core.api.FlywayException.class,upgrade::migrate);
        oldDb.update("UPDATE wf_execution SET state='SUCCESS' WHERE id='s1-history'");
        upgrade.repair(); // Only repairs this deliberately failed disposable test schema.
        upgrade.migrate();
        assertEquals("SUCCESS",oldDb.queryForObject("SELECT main_state FROM wf_execution WHERE id='s1-history'",String.class));
        assertEquals(0,oldDb.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='s2_upgrade_test' AND table_name='wf_flow_revision' AND column_name='checksum'",Integer.class));
        assertEquals("a".repeat(64),oldDb.queryForObject("SELECT request_hash FROM wf_execution WHERE id='s1-history'",String.class));
    }

    @Test void dispatchFailureRollsBackAttemptAndKeepsExecutorMessage() {
        drain();
        String executionId=custom("tasks: [{id: one, type: core.Log, message: dispatched}]\n");
        executor().processNext();
        jdbc().execute("CREATE TRIGGER fail_s2_dispatch BEFORE INSERT ON wf_worker_job FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected dispatch failure'");
        try {
            assertThrows(DataAccessException.class,()->executor().processNext());
            assertEquals(ExecutionState.CREATED,first(executionId).state());
            assertTrue(executions().attempts(actor,"lab",executionId,first(executionId).id()).isEmpty());
            assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM wf_message WHERE execution_id=?",Integer.class,executionId));
        } finally { jdbc().execute("DROP TRIGGER fail_s2_dispatch"); }
        drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
    }

    @Test void workerShutdownIsNotReportedAsBusinessFailure() throws Exception {
        String executionId=dispatchCustom("tasks: [{id: sleep, type: core.Sleep, duration: PT1S}]\n");
        try(var localWorker=new com.project.platform.runtime.worker.WorkerEngine(jobs(),context.getBean(com.project.platform.runtime.definition.TemplateRenderer.class),300,context.getBean(com.project.platform.runtime.worker.TaskRunner.class));
            var pool=Executors.newSingleThreadExecutor()) {
            var running=pool.submit(localWorker::runOnce);
            advanceUntil(()->jdbc().queryForObject("SELECT COUNT(*) FROM wf_worker_job WHERE state='RUNNING'",Integer.class)>0);
            localWorker.close();
            assertTrue(running.get(3,TimeUnit.SECONDS));
        }
        assertEquals(ExecutionState.RUNNING,first(executionId).state());
        assertNull(jobs().result(first(executionId).id(),1));
        jdbc().update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",first(executionId).id());
        drain();
        var attempts=executions().attempts(actor,"lab",executionId,first(executionId).id());
        assertEquals(1,attempts.size());
        assertEquals(ExecutionState.SUCCESS,attempts.getFirst().state());
    }

    private com.project.platform.runtime.scheduler.SchedulerEngine scheduler() { return context.getBean(com.project.platform.runtime.scheduler.SchedulerEngine.class); }
    private ExecutionRecord.TaskRun task(String executionId,String taskId) { return executions().tasks(actor,"lab",executionId).stream().filter(t->t.taskId().equals(taskId)).findFirst().orElseThrow(); }
    private String saveBody(String body) { String flowId=id();flows().save(actor,"lab",flowId,0,"schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\n"+body);return flowId; }
    private String submitEmpty(String flowId) { return executions().submit(actor,"lab",id(),new Request(flowId,null,Map.of())); }
    private void dueNow(String flowId) { jdbc().update("UPDATE wf_schedule SET next_fire=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE namespace='lab' AND flow_id=?",flowId); }

    @Test void reversedDagDispatchesBothBranchesBeforeJoin() {
        String executionId=dispatchCustom("""
                tasks:
                  - id: graph
                    type: core.Dag
                    tasks:
                      - {id: join, type: core.Log, dependsOn: [left, right], message: "{{ outputs.left.message }}+{{ outputs.right.message }}"}
                      - {id: right, type: core.Log, dependsOn: [seed], message: R}
                      - {id: left, type: core.Log, dependsOn: [seed], message: L}
                      - {id: seed, type: core.Log, message: start}
                outputs: {result: {source: TASK_OUTPUT, taskId: join, port: message}}
                """);
        assertEquals(ExecutionState.RUNNING,task(executionId,"seed").state());
        worker().runOnce();
        advanceUntil(()->task(executionId,"left").state()==ExecutionState.RUNNING && task(executionId,"right").state()==ExecutionState.RUNNING);
        assertEquals(ExecutionState.CREATED,task(executionId,"join").state());
        drain();
        assertEquals("L+R",executions().get(actor,"lab",executionId).outputs().get("result"));
        assertTrue(executions().attempts(actor,"lab",executionId,task(executionId,"graph").id()).isEmpty());
    }

    @Test void parallelJobsReallyOverlapInWorkers() throws Exception {
        String executionId=dispatchCustom("tasks: [{id: p, type: core.Parallel, tasks: [{id: a, type: core.Sleep, duration: PT1S}, {id: b, type: core.Sleep, duration: PT1S}]}]\n");
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(worker()::runOnce);var b=pool.submit(worker()::runOnce);
            advanceUntil(()->jdbc().queryForObject("SELECT COUNT(*) FROM wf_worker_job WHERE state='RUNNING'",Integer.class)==2);
            assertTrue(a.get(4,TimeUnit.SECONDS));assertTrue(b.get(4,TimeUnit.SECONDS));
        }
        drain();assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
    }

    @Test void ifChoiceSurvivesRestartAndUnselectedBranchNeverRuns() {
        String executionId=dispatchCustom("""
                tasks:
                  - id: choose
                    type: core.If
                    condition: 'false'
                    then: [{id: forbidden, type: core.Log, message: '{{ missing }}'}]
                    else: [{id: nested, type: core.Sequential, tasks: [{id: selected, type: core.Log, message: chosen}]}]
                outputs: {branch: {source: TASK_OUTPUT, taskId: choose, port: evaluationResult}}
                """);
        var before=task(executionId,"choose");assertEquals(false,before.outputs().get("evaluationResult"));
        context.close();context=open();drain();
        assertEquals(before.startedAt(),task(executionId,"choose").startedAt());
        assertEquals(false,executions().get(actor,"lab",executionId).outputs().get("branch"));
        assertEquals(ExecutionState.SKIPPED,task(executionId,"forbidden").state());
        assertTrue(executions().attempts(actor,"lab",executionId,task(executionId,"forbidden").id()).isEmpty());
    }

    @Test void badConditionAndUnselectedOutputFailWithoutStuckExecution() {
        for(String body:List.of(
                "tasks: [{id: c, type: core.If, condition: maybe, then: [{id: leaf, type: core.Log, message: hi}]}]\n",
                "tasks: [{id: c, type: core.If, condition: 'false', then: [{id: leaf, type: core.Log, message: hi}]}]\noutputs: {x: {source: TASK_OUTPUT, taskId: leaf, port: message}}\n")) {
            String executionId=custom(body+"errors: [{id: error, type: core.Log, message: handled}]\nfinally: [{id: cleanup, type: core.Log, message: cleaned}]\n");
            drain();assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",executionId).state());
            assertEquals(ExecutionState.SUCCESS,task(executionId,"cleanup").state());
            assertEquals(ExecutionState.SUCCESS,task(executionId,"error").state());
        }
    }

    @Test void parallelFailureWaitsForRunningSiblingBeforeCleanup() {
        String executionId=dispatchCustom("tasks: [{id: p, type: core.Parallel, tasks: [{id: bad, type: core.Log, message: bad}, {id: slow, type: core.Log, message: slow}]}]\nfinally: [{id: cleanup, type: core.Log, message: cleaned}]\n");
        var one=jobs().claim("one",30000);var two=jobs().claim("two",30000);
        var bad=one.job().task().id().equals("bad")?one:two;var slow=bad==one?two:one;
        assertTrue(jobs().finish(bad,com.project.platform.runtime.worker.WorkerJob.Result.failed("original failure")));
        advanceUntil(()->task(executionId,"bad").state()==ExecutionState.FAILED);
        assertEquals(ExecutionState.CREATED,task(executionId,"cleanup").state());
        assertEquals(ExecutionState.RUNNING,task(executionId,"p").state());
        assertTrue(jobs().finish(slow,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","slow"))));
        drain();assertEquals("original failure",executions().get(actor,"lab",executionId).error());
        assertEquals(ExecutionState.SUCCESS,task(executionId,"cleanup").state());
    }

    @Test void cancellationFencesAllParallelJobsAndRunsOneCleanup() {
        String executionId=dispatchCustom("tasks: [{id: p, type: core.Parallel, tasks: [{id: a, type: core.Sleep, duration: PT10S}, {id: b, type: core.Sleep, duration: PT10S}]}]\nfinally: [{id: cleanup, type: core.Log, message: cleaned}]\n");
        var one=jobs().claim("one",30000);var two=jobs().claim("two",30000);
        executions().cancel(actor,"lab",executionId);drain();
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",executionId).state());
        assertFalse(jobs().finish(one,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of())));
        assertFalse(jobs().finish(two,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of())));
        assertEquals(1,executions().attempts(actor,"lab",executionId,task(executionId,"cleanup").id()).size());
    }

    @Test void concurrentSubmissionsRespectFlowLimitAndPersistentFifo() throws Exception {
        drain();String flowId=saveBody("concurrency: {limit: 2, behavior: QUEUE}\ntasks: [{id: task, type: core.Log, message: hi}]\n");
        try(var pool=Executors.newFixedThreadPool(6)) {
            var jobs=new ArrayList<Future<String>>();for(int i=0;i<10;i++) jobs.add(pool.submit(()->submitEmpty(flowId)));
            for(var job:jobs) job.get(10,TimeUnit.SECONDS);
        }
        assertEquals(2,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND state='CREATED'",Integer.class,flowId));
        assertEquals(8,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND state='QUEUED'",Integer.class,flowId));
        var expected=jdbc().queryForList("SELECT id FROM wf_execution WHERE flow_id=? ORDER BY sequence_no",String.class,flowId);
        context.close();context=open();drain();
        var actual=jdbc().queryForList("SELECT id FROM wf_execution WHERE flow_id=? ORDER BY started_at,sequence_no",String.class,flowId);
        assertEquals(expected,actual);
        assertEquals(10,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND state='SUCCESS'",Integer.class,flowId));
    }

    @Test void failAdmissionAndQueuedCancellationCreateNoAttemptsOrCleanup() {
        drain();String failFlow=saveBody("concurrency: {limit: 1, behavior: FAIL}\ntasks: [{id: task, type: core.Log, message: hi}]\nfinally: [{id: cleanup, type: core.Log, message: cleaned}]\n");
        String first=submitEmpty(failFlow),rejected=submitEmpty(failFlow);
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",rejected).state());
        assertTrue(executions().attempts(actor,"lab",rejected,task(rejected,"task").id()).isEmpty());
        assertEquals(ExecutionState.SKIPPED,task(rejected,"cleanup").state());
        drain();assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",first).state());
        String queue=saveBody("concurrency: {limit: 1}\ntasks: [{id: task, type: core.Log, message: hi}]\nfinally: [{id: cleanup, type: core.Log, message: cleaned}]\n");
        submitEmpty(queue);String cancelled=submitEmpty(queue);executions().cancel(actor,"lab",cancelled);
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",cancelled).state());
        assertEquals(ExecutionState.SKIPPED,task(cancelled,"cleanup").state());drain();
    }

    @Test void slotIsHeldUntilFinallyEndsAndReleasedOnCleanupFailure() {
        drain();String flowId=saveBody("concurrency: {limit: 1}\ntasks: [{id: task, type: core.Log, message: hi}]\nfinally: [{id: cleanup, type: core.Log, message: '{{ missing }}'}]\n");
        String first=submitEmpty(flowId),second=submitEmpty(flowId);
        executor().processNext();executor().processNext();worker().runOnce();
        advanceUntil(()->task(first,"cleanup").state()==ExecutionState.RUNNING);
        assertEquals(ExecutionState.QUEUED,executions().get(actor,"lab",second).state());
        drain();assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",first).state());
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",second).state());
        assertNotNull(executions().get(actor,"lab",second).startedAt());
    }

    @Test void latestConcurrencyPolicyAppliesAcrossVersionsWithoutKillingActiveRuns() {
        drain();String body="concurrency: {limit: 1}\ntasks: [{id: task, type: core.Log, message: hi}]\n";
        String flowId=saveBody(body);String first=submitEmpty(flowId),second=submitEmpty(flowId);
        String source="schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\n"+body;
        flows().save(actor,"lab",flowId,1,source.replace("limit: 1","limit: 2"));
        assertEquals(ExecutionState.CREATED,executions().get(actor,"lab",second).state());
        flows().save(actor,"lab",flowId,2,source);
        String third=executions().submit(actor,"lab",id(),new Request(flowId,1,Map.of()));
        assertEquals(ExecutionState.QUEUED,executions().get(actor,"lab",third).state());
        assertEquals(ExecutionState.CREATED,executions().get(actor,"lab",first).state());drain();
    }

    @Test void twoSchedulersCreateOneDurableFiringAndAdvanceCursor() throws Exception {
        drain();String flowId=saveBody("schedule: {cron: '0 0 0 * * *'}\ntasks: [{id: task, type: core.Log, message: scheduled}]\n");
        dueNow(flowId);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var one=pool.submit(scheduler()::runOnce);var two=pool.submit(scheduler()::runOnce);
            assertEquals(1,(one.get(10,TimeUnit.SECONDS)?1:0)+(two.get(10,TimeUnit.SECONDS)?1:0));
        }
        assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=?",Integer.class,flowId));
        assertFalse(scheduler().runOnce());drain();
    }

    @Test void schedulerCursorAndSubmissionRollbackTogether() {
        drain();String flowId=saveBody("schedule: {cron: '0 0 0 * * *'}\ntasks: [{id: task, type: core.Log, message: scheduled}]\n");
        dueNow(flowId);var before=jdbc().queryForObject("SELECT next_fire FROM wf_schedule WHERE flow_id=?",java.sql.Timestamp.class,flowId);
        jdbc().execute("CREATE TRIGGER fail_s3_schedule BEFORE INSERT ON wf_message FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected schedule failure'");
        try {
            assertThrows(DataAccessException.class,()->scheduler().runOnce());
            assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=?",Integer.class,flowId));
            assertEquals(before,jdbc().queryForObject("SELECT next_fire FROM wf_schedule WHERE flow_id=?",java.sql.Timestamp.class,flowId));
        } finally { jdbc().execute("DROP TRIGGER fail_s3_schedule"); }
        context.close();context=open();assertTrue(scheduler().runOnce());drain();
    }

    @Test void scheduleEditDisableAndReenableHaveExplicitCursorSemantics() {
        drain();String body="schedule: {cron: '0 0 0 * * *'}\ntasks: [{id: task, type: core.Log, message: first}]\n";
        String flowId=saveBody(body);dueNow(flowId);
        var before=jdbc().queryForObject("SELECT next_fire FROM wf_schedule WHERE flow_id=?",java.sql.Timestamp.class,flowId);
        String source="schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\n"+body;
        flows().save(actor,"lab",flowId,1,source.replace("message: first","message: second"));
        assertEquals(before,jdbc().queryForObject("SELECT next_fire FROM wf_schedule WHERE flow_id=?",java.sql.Timestamp.class,flowId));
        assertTrue(scheduler().runOnce());drain();
        assertEquals(2,jdbc().queryForObject("SELECT flow_revision FROM wf_execution WHERE flow_id=?",Integer.class,flowId));
        flows().save(actor,"lab",flowId,2,source.replace("cron:","disabled: true, cron:"));
        assertNull(jdbc().queryForObject("SELECT next_fire FROM wf_schedule WHERE flow_id=?",java.sql.Timestamp.class,flowId));
        assertFalse(scheduler().runOnce());
        flows().save(actor,"lab",flowId,3,source);
        assertTrue(jdbc().queryForObject("SELECT next_fire>CURRENT_TIMESTAMP(6) FROM wf_schedule WHERE flow_id=?",Boolean.class,flowId));
        flows().save(actor,"lab",flowId,4,source.replace("schedule: {cron: '0 0 0 * * *'}\n",""));
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_schedule WHERE flow_id=?",Integer.class,flowId));
    }

    @Test void scheduleNeedsExecutePermissionAndRejectsReservedManualKeys() {
        String flowId=id();String source="schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\nschedule: {cron: '0 0 0 * * *'}\ntasks: [{id: task, type: core.Log, message: hi}]\n";
        var writeOnly=new Actor("editor",Set.of("lab"),Set.of(Action.WRITE));
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->flows().save(writeOnly,"lab",flowId,0,source));
        flows().save(actor,"lab",flowId,0,source);
        assertThrows(WorkflowException.class,()->executions().submit(actor,"lab","schedule:forged",new Request(flowId,null,Map.of())));
        drain();
    }

    @Test void missedScheduleCoalescesAndUsesTheNormalAdmissionQueue() {
        drain();String flowId=saveBody("schedule: {cron: '0 0 0 * * *'}\nconcurrency: {limit: 1}\ntasks: [{id: task, type: core.Log, message: hi}]\n");
        submitEmpty(flowId);
        jdbc().update("UPDATE wf_schedule SET next_fire=TIMESTAMPADD(DAY,-5,CURRENT_TIMESTAMP(6)) WHERE flow_id=?",flowId);
        context.close();context=open();assertTrue(scheduler().runOnce());assertFalse(scheduler().runOnce());
        assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND state='QUEUED'",Integer.class,flowId));
        drain();assertEquals(2,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND state='SUCCESS'",Integer.class,flowId));
    }

    @Test void workerPumpRunsParallelLeavesInOneRealJvm() throws Exception {
        String executionId=dispatchCustom("tasks: [{id: p, type: core.Parallel, tasks: [{id: a, type: core.Sleep, duration: PT2S}, {id: b, type: core.Sleep, duration: PT2S}]}]\n");
        int port;try(var socket=new ServerSocket(0)) { port=socket.getLocalPort(); }
        Process child=null;
        try {
            child=startChild(port,false,true,"s3-parallel-worker");awaitChild(child,port);
            advanceUntil(()->jdbc().queryForObject("SELECT COUNT(*) FROM wf_worker_job j JOIN wf_task_run t ON t.id=j.task_run_id WHERE t.execution_id=? AND j.state='RUNNING'",Integer.class,executionId)==2);
            advanceUntil(()->executions().get(actor,"lab",executionId).state().terminal());
            assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",executionId).state());
        } finally { if(child!=null && child.isAlive()) { child.destroyForcibly();child.waitFor(10,TimeUnit.SECONDS); } }
    }

    @Test void cancelDuringParallelRetryRacesWithAdmissionWithoutDeadlock() throws Exception {
        drain();String flowId=saveBody("concurrency: {limit: 1}\ntasks: [{id: p, type: core.Parallel, tasks: [{id: bad, type: core.Log, message: '{{ missing }}', retry: {type: constant, maxAttempts: 2, interval: PT10S}}, {id: good, type: core.Log, message: done}]}]\nfinally: [{id: cleanup, type: core.Log, message: cleaned}]\n");
        String first=submitEmpty(flowId),second=submitEmpty(flowId);
        executor().processNext();executor().processNext();worker().runOnce();worker().runOnce();
        advanceUntil(()->task(first,"bad").state()==ExecutionState.RETRYING);
        try(var pool=Executors.newFixedThreadPool(3)) {
            var cancelActive=pool.submit(()->executions().cancel(actor,"lab",first));
            var cancelQueued=pool.submit(()->executions().cancel(actor,"lab",second));
            var newSubmit=pool.submit(()->submitEmpty(flowId));
            cancelActive.get(10,TimeUnit.SECONDS);cancelQueued.get(10,TimeUnit.SECONDS);
            String third=newSubmit.get(10,TimeUnit.SECONDS);executions().cancel(actor,"lab",third);
        }
        drain();assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",first).state());
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",second).state());
        assertEquals(1,executions().attempts(actor,"lab",first,task(first,"bad").id()).size());
        assertEquals(ExecutionState.SUCCESS,task(first,"cleanup").state());
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND state IN ('CREATED','QUEUED','RUNNING','KILLING')",Integer.class,flowId));
    }

    @Test void scheduleSaveFailureRollsBackRevisionAndConcurrencyTogether() {
        drain();String body="concurrency: {limit: 1}\ntasks: [{id: task, type: core.Log, message: hi}]\n";
        String flowId=saveBody(body);String first=submitEmpty(flowId),second=submitEmpty(flowId);
        jdbc().execute("CREATE TRIGGER fail_schedule_config BEFORE INSERT ON wf_schedule FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected config failure'");
        try {
            String source="schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\nschedule: {cron: '0 0 0 * * *'}\n"+body.replace("limit: 1","limit: 2");
            assertThrows(DataAccessException.class,()->flows().save(actor,"lab",flowId,1,source));
            assertEquals(1,flows().get(actor,"lab",flowId,null).revision());
            assertEquals(1,jdbc().queryForObject("SELECT concurrency_limit FROM wf_flow_control WHERE flow_id=?",Integer.class,flowId));
            assertEquals(ExecutionState.QUEUED,executions().get(actor,"lab",second).state());
            assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_message WHERE execution_id=?",Integer.class,second));
        } finally { jdbc().execute("DROP TRIGGER fail_schedule_config"); }
        drain();assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",first).state());
    }

    @Test void s3MigrationRejectsActiveS2AndPreservesCompletedHistory() throws Exception {
        var created=mysql.execInContainer("mysql","-uroot","-p"+mysql.getPassword(),"-e",
                "CREATE DATABASE s3_upgrade_test; GRANT ALL ON s3_upgrade_test.* TO 'backend_test'@'%';");
        assertEquals(0,created.getExitCode(),created.getStderr());
        String url=mysql.getJdbcUrl().replace("/backend_s1_test","/s3_upgrade_test");
        org.flywaydb.core.Flyway.configure().dataSource(url,mysql.getUsername(),mysql.getPassword())
                .locations("classpath:db/migration/runtime","classpath:db/migration/dataflow").target("4").load().migrate();
        var oldDb=new JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(url,mysql.getUsername(),mysql.getPassword()));
        oldDb.update("INSERT INTO wf_execution(id,namespace,flow_id,flow_revision,submitted_by,request_key,request_hash,state,definition_json,inputs_json,variables_json,outputs_json,created_at) VALUES('s2-history','lab','old',1,'writer','old-key',?,'KILLING','{}','{}','{}','{}',CURRENT_TIMESTAMP(6))","b".repeat(64));
        var upgrade=org.flywaydb.core.Flyway.configure().dataSource(url,mysql.getUsername(),mysql.getPassword())
                .locations("classpath:db/migration/runtime","classpath:db/migration/dataflow").load();
        assertThrows(org.flywaydb.core.api.FlywayException.class,upgrade::migrate);
        oldDb.update("UPDATE wf_execution SET state='KILLED',main_state='KILLED' WHERE id='s2-history'");
        upgrade.repair(); // Only this disposable schema's deliberately failed migration.
        upgrade.migrate();
        assertEquals("KILLED",oldDb.queryForObject("SELECT main_state FROM wf_execution WHERE id='s2-history'",String.class));
        assertEquals(0,oldDb.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='s3_upgrade_test' AND table_name='wf_execution' AND column_name='next_task'",Integer.class));
        assertTrue(oldDb.queryForObject("SELECT sequence_no FROM wf_execution WHERE id='s2-history'",Long.class)>0);
        assertEquals("b".repeat(64),oldDb.queryForObject("SELECT request_hash FROM wf_execution WHERE id='s2-history'",String.class));
    }

    @Test void checkedInS3ExampleExecutesBothChoicesThroughAllControlTypes() throws Exception {
        drain();String flowId=id();String source=Files.readString(Path.of("..","examples","s3-control-flow.yaml")).replace("id: control-demo","id: "+flowId);
        flows().save(actor,"lab",flowId,0,source);
        for(boolean publish:List.of(true,false)) {
            String executionId=executions().submit(actor,"lab",id(),new Request(flowId,null,Map.of("publish",publish)));
            drain();var execution=executions().get(actor,"lab",executionId);
            assertEquals(ExecutionState.SUCCESS,execution.state());
            assertEquals("left + right",execution.outputs().get("result"));
            assertEquals(publish,execution.outputs().get("published"));
            assertEquals(publish?ExecutionState.SUCCESS:ExecutionState.SKIPPED,task(executionId,"remote").state());
            assertEquals(publish?ExecutionState.SKIPPED:ExecutionState.SUCCESS,task(executionId,"notPublished").state());
        }
    }

    @Test void separateSchedulerJvmCreatesExecutionsWithoutWorkersOrExecutor() throws Exception {
        drain();String body="schedule: {cron: '*/1 * * * * *'}\nconcurrency: {limit: 1}\ntasks: [{id: task, type: core.Log, message: scheduled}]\n";
        String flowId=saveBody(body);int port;try(var socket=new ServerSocket(0)) { port=socket.getLocalPort(); }
        Process child=null;
        try {
            child=startChild(port,false,false,true,"s3-scheduler");awaitChild(child,port);
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
            while(jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=?",Integer.class,flowId)==0 && System.nanoTime()<deadline) pause(50);
            assertTrue(jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=?",Integer.class,flowId)>0);
            assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND started_at IS NOT NULL",Integer.class,flowId));
        } finally { if(child!=null && child.isAlive()) { child.destroyForcibly();child.waitFor(10,TimeUnit.SECONDS); } }
        flows().save(actor,"lab",flowId,1,"schemaVersion: 1\nnamespace: lab\nid: "+flowId+"\n"+body.replace("cron:","disabled: true, cron:"));
        drain();assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution WHERE flow_id=? AND state<>'SUCCESS'",Integer.class,flowId));
    }

    private ResourceCatalogService resources() { return context.getBean(ResourceCatalogService.class); }
    private ApplicationCatalogService applications() { return context.getBean(ApplicationCatalogService.class); }
    private Parameter parameter(ValueType type,boolean required,Object value) { return new Parameter(type,required,value,List.of(),null); }
    private ApplicationVersion application(Map<String,Parameter> parameters) {
        String id=id();return applications().register(actor,"lab",id,"v1",new ApplicationVersion(id,"v1","registry.example/lab/train:v1",parameters));
    }

    @Test void applicationVersionPersistsAcrossRestartAndCannotBeOverwritten() {
        var app=application(Map.of("EPOCHS",parameter(ValueType.INTEGER,true,2),"RATE",parameter(ValueType.NUMBER,true,0.01)));
        context.close();context=open();
        assertEquals(app,applications().get(actor,"lab",app.applicationId(),"v1"));
        assertEquals(app,applications().register(actor,"lab",app.applicationId(),"v1",app));
        var changed=new ApplicationVersion(app.applicationId(),"v1","registry.example/lab/train:v2",app.parameters());
        assertEquals(ApplicationException.Kind.CONFLICT,assertThrows(ApplicationException.class,()->applications().register(actor,"lab",app.applicationId(),"v1",changed)).kind());
        applications().register(actor,"lab",app.applicationId(),"v2",new ApplicationVersion(app.applicationId(),"v2",changed.image(),app.parameters()));
        assertEquals(app,applications().get(actor,"lab",app.applicationId(),"v1"));
    }

    @Test void concurrentApplicationRegistrationAcceptsSameContentAndRejectsConflicts() throws Exception {
        String id=id();var one=new ApplicationVersion(id,"v1","registry.example/lab/train:v1",Map.of("RATE",parameter(ValueType.NUMBER,true,1.0)));
        try(var pool=Executors.newFixedThreadPool(8)) {
            var futures=new ArrayList<Future<ApplicationVersion>>();
            for(int i=0;i<8;i++) futures.add(pool.submit(()->applications().register(actor,"lab",id,"v1",one)));
            for(var result:futures) assertEquals("v1",result.get().version());
            var a=pool.submit(()->applications().register(actor,"lab",id,"v2",new ApplicationVersion(id,"v2","registry.example/lab/train:a",one.parameters())));
            var b=pool.submit(()->applications().register(actor,"lab",id,"v2",new ApplicationVersion(id,"v2","registry.example/lab/train:b",one.parameters())));
            int conflicts=0;
            for(var future:List.of(a,b)) try { future.get(); } catch(ExecutionException ex) { assertInstanceOf(ApplicationException.class,ex.getCause());assertEquals(ApplicationException.Kind.CONFLICT,((ApplicationException)ex.getCause()).kind());conflicts++; }
            assertEquals(1,conflicts);
        }
        assertEquals(2,jdbc().queryForObject("SELECT COUNT(*) FROM dep_application_version WHERE application_id=?",Integer.class,id));
    }

    @Test void applicationContractValidatesTypesDefaultsChoicesAndImageReference() {
        String id=id();
        for(String image:List.of("train","https://registry.example/train:v1","user:password@registry/train:v1","repo::tag","repo//train:v1","repo@sha256:bad"))
            assertThrows(ApplicationException.class,()->applications().register(actor,"lab",id,"v1",new ApplicationVersion(id,"v1",image,Map.of())));
        assertThrows(ApplicationException.class,()->application(Map.of("N",parameter(ValueType.INTEGER,true,1.5))));
        assertThrows(ApplicationException.class,()->application(Map.of("N",parameter(ValueType.INTEGER,true,new java.math.BigInteger("9223372036854775808")))));
        assertThrows(ApplicationException.class,()->application(Map.of("N",parameter(ValueType.NUMBER,true,Double.NaN))));
        assertThrows(ApplicationException.class,()->application(Map.of("N",new Parameter(ValueType.STRING,true,"a",List.of("b"),null))));
        assertThrows(ApplicationException.class,()->application(Map.of("N",new Parameter(ValueType.INTEGER,true,1,List.of(1,1L),null))));
        assertThrows(ApplicationException.class,()->application(Map.of("bad-name",parameter(ValueType.STRING,false,null))));
        applications().register(actor,"lab",id,"v1",new ApplicationVersion(id,"v1","localhost:5000/lab/train:v1",Map.of()));
        applications().register(actor,"lab",id,"v2",new ApplicationVersion(id,"v2","registry.example/lab/train@sha256:"+"a".repeat(64),Map.of()));
    }

    @Test void datasetContractRequiresRegisteredVersionAndMatchingFormatInSameNamespace() {
        String cluster=resourceCluster(Kind.EDGE,true),data=id();resourceDataset(data,"v1","pt",cluster);
        var rule=new DatasetRule("pt",List.of(new DatasetRef(data,"v1")));
        application(Map.of("DATASET",new Parameter(ValueType.STRING,true,data+"/v1",List.of(),rule)));
        assertThrows(ApplicationException.class,()->application(Map.of("DATASET",new Parameter(ValueType.STRING,true,"unlisted/v1",List.of(),rule))));
        assertThrows(ApplicationException.class,()->application(Map.of("DATASET",new Parameter(ValueType.STRING,true,null,List.of(),new DatasetRule("f32",rule.allowed())))));
        assertThrows(ResourceException.class,()->application(Map.of("DATASET",new Parameter(ValueType.STRING,true,null,List.of(),new DatasetRule("pt",List.of(new DatasetRef(data,"v2")))))));
        assertThrows(ApplicationException.class,()->application(Map.of("DATASET",new Parameter(ValueType.INTEGER,true,null,List.of(),rule))));
        var other=new Actor("other",Set.of("other"),Set.of(Action.READ,Action.WRITE));String app=id();
        assertThrows(ResourceException.class,()->applications().register(other,"other",app,"v1",new ApplicationVersion(app,"v1","train:v1",Map.of("DATASET",new Parameter(ValueType.STRING,true,null,List.of(),rule)))));
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM dep_application_version WHERE application_id=?",Integer.class,app));
    }

    @Test void applicationListsAreScopedPagedAndScalarReplayIsNormalized() {
        var scoped=new Actor("scope",Set.of("apps"),Set.of(Action.READ,Action.WRITE));
        for(String id:List.of("c","a","b")) applications().register(scoped,"apps",id,"v1",new ApplicationVersion(id,"v1","train:v1",Map.of("RATE",parameter(ValueType.NUMBER,true,1.0))));
        applications().register(scoped,"apps","a","v1",new ApplicationVersion("a","v1","train:v1",Map.of("RATE",parameter(ValueType.NUMBER,true,1))));
        var precise=applications().register(scoped,"apps","a","v2",new ApplicationVersion("a","v2","train:v1",Map.of("RATE",parameter(ValueType.NUMBER,true,new java.math.BigDecimal("0.12345678901234567890123456789")))));
        assertEquals(precise,applications().get(scoped,"apps","a","v2"));
        assertEquals(precise,applications().register(scoped,"apps","a","v2",precise));
        assertEquals(List.of("b","c"),applications().list(scoped,"apps",2,2).stream().map(ApplicationVersion::applicationId).toList());
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->applications().list(scoped,"lab",20,0));
        assertThrows(ApplicationException.class,()->applications().list(scoped,"apps",0,0));
        assertThrows(ApplicationException.class,()->applications().list(scoped,"apps",20,-1));
    }

    @Test void checkedInApplicationContractRegistersAndReadsBack() throws Exception {
        String cluster=resourceCluster(Kind.EDGE,true);resourceDataset("mnist","v1","pt",cluster);
        var app=json.read(Files.readString(Path.of("..","examples","s4-application-contract.json")),ApplicationVersion.class);
        var saved=applications().register(actor,"lab",app.applicationId(),app.version(),app);
        assertEquals(saved,applications().get(actor,"lab",app.applicationId(),app.version()));
        assertEquals(1024L,saved.parameters().get("CHUNK").defaultValue());
        assertEquals(List.of(new DatasetRef("mnist","v1")),saved.parameters().get("DATASET").dataset().allowed());
    }

    @Test void applicationHttpApiEnforcesNamespaceAndReadWrite() throws Exception {
        String id=id(),base="/api/namespaces/lab/applications",path=base+"/"+id+"/versions/v1";
        var app=new ApplicationVersion(id,"v1","train:v1",Map.of("N",parameter(ValueType.INTEGER,true,2)));
        assertEquals(401,call(port(),"PUT",path,null,app,null).statusCode());
        assertEquals(403,call(port(),"PUT",path,"viewer",app,null).statusCode());
        assertEquals(200,call(port(),"PUT",path,"writer",app,null).statusCode());
        assertEquals(200,call(port(),"GET",path,"viewer",null,null).statusCode());
        assertEquals(404,call(port(),"GET",path.replace("v1","missing"),"viewer",null,null).statusCode());
        assertEquals(403,call(port(),"GET",path.replace("/lab/","/other/"),"viewer",null,null).statusCode());
        assertEquals(422,call(port(),"GET",base+"?limit=101","viewer",null,null).statusCode());
        assertEquals(400,call(port(),"PUT",path,"writer",Map.of("applicationId",id,"version","v1","image","train:v1","unknown",true),null).statusCode());

    }
    @Test void removedApplicationBindingRoutesAreNotAvailable() throws Exception {
        for(String operation:List.of("plan","resolve"))
            assertEquals(404,call(port(),"POST","/api/namespaces/lab/application-bindings/"+operation,
                    "writer",Map.of("tasks",List.of()),null).statusCode());
    }

    @Test void applicationRegistrationDoesNotDeriveInputsOrChangeFlowExecution() {
        String flowId=register();
        var before=flows().get(actor,"lab",flowId,1);
        int flowCount=jdbc().queryForObject("SELECT COUNT(*) FROM wf_flow_revision",Integer.class);
        int executionCount=jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution",Integer.class);
        application(Map.of("name",parameter(ValueType.INTEGER,true,99),"REQUIRED",parameter(ValueType.STRING,true,null)));
        assertEquals(before,flows().get(actor,"lab",flowId,1));
        assertEquals(Set.of("name","count"),before.definition().inputs().keySet());
        assertEquals(flowCount,jdbc().queryForObject("SELECT COUNT(*) FROM wf_flow_revision",Integer.class));
        assertEquals(executionCount,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution",Integer.class));
        String executionId=executions().submit(actor,"lab",id(),request(flowId));
        drain();
        var result=executions().get(actor,"lab",executionId);
        assertEquals(ExecutionState.SUCCESS,result.state());
        assertEquals("Hello Ada; count=2",result.outputs().get("result"));
    }

    private String resourceCluster(Kind kind,boolean enabled) {
        String id=id();resources().putCluster(actor,"lab",id,new Cluster(id,kind,enabled));return id;
    }
    private DatasetVersion resourceDataset(String id,String version,String format,String... clusterIds) {
        return resources().registerDataset(actor,"lab",id,version,new DatasetVersion(id,version,format,
                Arrays.stream(clusterIds).map(c->new Location(c,"s3://datasets/"+id+"/"+version+"/"+c+"/data.bin")).toList()));
    }

    @Test void resourceCatalogPersistsAcrossRestartAndClusterCanBeDisabled() {
        String cluster=resourceCluster(Kind.EDGE,true),data=id();var saved=resourceDataset(data,"v1","f32",cluster);
        context.close();context=open();assertEquals(saved,resources().dataset(actor,"lab",data,"v1"));
        assertTrue(resources().cluster(actor,"lab",cluster).enabled());
        resources().putCluster(actor,"lab",cluster,new Cluster(cluster,Kind.EDGE,false));
        assertFalse(resources().cluster(actor,"lab",cluster).enabled());
        assertEquals(saved,resources().dataset(actor,"lab",data,"v1"));
    }

    @Test void datasetVersionIsImmutableAndRepeatedRegistrationIgnoresLocationOrder() {
        String a=resourceCluster(Kind.EDGE,true),b=resourceCluster(Kind.CLOUD,true),data=id();
        var one=resourceDataset(data,"v1","pt",a,b);
        var again=resourceDataset(data,"v1","pt",b,a);
        assertEquals(one,again);
        assertEquals(ResourceException.Kind.CONFLICT,assertThrows(ResourceException.class,()->resourceDataset(data,"v1","f32",a,b)).kind());
        var changed=new DatasetVersion(data,"v1","pt",List.of(new Location(a,"s3://datasets/changed/data.pt"),new Location(b,"s3://datasets/changed/data.pt")));
        assertThrows(ResourceException.class,()->resources().registerDataset(actor,"lab",data,"v1",changed));
        resourceDataset(data,"v2","f32",a);assertEquals(one,resources().dataset(actor,"lab",data,"v1"));
        assertEquals("f32",resources().dataset(actor,"lab",data,"v2").format());
    }

    @Test void concurrentDatasetRegistrationHasOneImmutableVersion() throws Exception {
        String a=resourceCluster(Kind.EDGE,true),data=id();
        try(var pool=Executors.newFixedThreadPool(6)) {
            var calls=new ArrayList<Future<DatasetVersion>>();for(int i=0;i<8;i++) calls.add(pool.submit(()->resourceDataset(data,"1","pt",a)));
            for(var call:calls) assertEquals("pt",call.get(10,TimeUnit.SECONDS).format());
        }
        assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM res_dataset_version WHERE dataset_id=?",Integer.class,data));
        assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM res_dataset_location WHERE dataset_id=?",Integer.class,data));
    }

    @Test void concurrentConflictingDatasetRegistrationDoesNotMixLocationsOrFormat() throws Exception {
        String a=resourceCluster(Kind.EDGE,true),b=resourceCluster(Kind.CLOUD,true),data=id();
        try(var pool=Executors.newFixedThreadPool(2)) {
            var one=pool.submit(()->resourceDataset(data,"v1","pt",a));
            var two=pool.submit(()->resourceDataset(data,"v1","f32",b));
            int conflicts=0;for(var call:List.of(one,two)) {
                try { call.get(10,TimeUnit.SECONDS); }
                catch(ExecutionException ex) { assertInstanceOf(ResourceException.class,ex.getCause());assertEquals(ResourceException.Kind.CONFLICT,((ResourceException)ex.getCause()).kind());conflicts++; }
            }
            assertEquals(1,conflicts);
        }
        var saved=resources().dataset(actor,"lab",data,"v1");assertEquals(1,saved.locations().size());
        assertEquals(saved.format().equals("pt")?a:b,saved.locations().getFirst().clusterId());
    }

    @Test void datasetAndAllLocationsRollbackWhenOneLocationWriteFails() {
        String a=resourceCluster(Kind.EDGE,true),b=resourceCluster(Kind.EDGE,true),data=id();
        String last=a.compareTo(b)>0?a:b;
        jdbc().execute("CREATE TRIGGER fail_s4_location BEFORE INSERT ON res_dataset_location FOR EACH ROW BEGIN IF NEW.cluster_id='"+last+"' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected location failure'; END IF; END");
        try {
            assertThrows(DataAccessException.class,()->resourceDataset(data,"v1","pt",a,b));
            assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM res_dataset_version WHERE dataset_id=?",Integer.class,data));
            assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM res_dataset_location WHERE dataset_id=?",Integer.class,data));
        } finally { jdbc().execute("DROP TRIGGER fail_s4_location"); }
        assertEquals(2,resourceDataset(data,"v1","pt",a,b).locations().size());
    }

    @Test void datasetRequiresClusterInSameNamespaceAndLeavesNoPartialRows() {
        String foreign=id(),data=id();var other=new Actor("other",Set.of("other"),Set.of(Action.READ,Action.WRITE));
        resources().putCluster(other,"other",foreign,new Cluster(foreign,Kind.CLOUD,true));
        assertEquals(ResourceException.Kind.NOT_FOUND,assertThrows(ResourceException.class,()->resourceDataset(data,"v1","pt",foreign)).kind());
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM res_dataset_version WHERE dataset_id=?",Integer.class,data));
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->resources().cluster(actor,"other",foreign));
    }

    @Test void placementRequiresAllDatasetVersionsLocalAndDoesNotCreateExecutionOrReservation() {
        String a=resourceCluster(Kind.EDGE,true),b=resourceCluster(Kind.EDGE,true),c=resourceCluster(Kind.CLOUD,true),train=id(),model=id();
        resourceDataset(train,"v1","pt",a,b);resourceDataset(model,"v1","pt",b,c);
        int before=jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution",Integer.class);
        var options=resources().placementOptions(actor,"lab",new PlacementRequest(List.of(a,b,c),List.of(new DatasetRequirement(train,"v1","pt"),new DatasetRequirement(model,"v1","pt"))));
        assertFalse(options.get(0).eligible());assertTrue(options.get(1).eligible());assertFalse(options.get(2).eligible());
        assertEquals(List.of("DATASET_NOT_LOCAL:"+model+"/v1"),options.get(0).reasons());
        assertEquals(2,options.get(1).datasets().size());
        assertTrue(options.get(1).datasets().stream().allMatch(d->d.uri().contains("/"+b+"/")));
        assertEquals(before,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution",Integer.class));
        assertEquals(List.of(c,a),resources().placementOptions(actor,"lab",new PlacementRequest(List.of(c,a),List.of())).stream().map(PlacementOption::clusterId).toList());
    }

    @Test void placementReportsDisabledFormatMismatchAndMissingLocalCopySeparately() {
        String a=resourceCluster(Kind.CLOUD,false),b=resourceCluster(Kind.EDGE,true),data=id();resourceDataset(data,"v1","pt",b);
        var options=resources().placementOptions(actor,"lab",new PlacementRequest(List.of(a,b),List.of(new DatasetRequirement(data,"v1","f32"))));
        assertEquals(List.of("CLUSTER_DISABLED","FORMAT_MISMATCH:"+data+"/v1","DATASET_NOT_LOCAL:"+data+"/v1"),options.get(0).reasons());
        assertEquals(List.of("FORMAT_MISMATCH:"+data+"/v1"),options.get(1).reasons());
        assertThrows(ResourceException.class,()->resources().placementOptions(actor,"lab",new PlacementRequest(List.of(a),List.of(new DatasetRequirement(data,"missing",null)))));
    }

    @Test void resourceRequestsRejectAmbiguousIdsDuplicatesAndCredentialUris() {
        String a=resourceCluster(Kind.EDGE,true),data=id();
        for(String uri:List.of("http://example.com/data","s3://user:password@datasets/data","s3://datasets/data?token=x","s3://datasets/data#x","s3://datasets/../data","s3://datasets/%2e%2e/data","s3://datasets/","s3://datasets:9000/data")) {
            assertEquals(ResourceException.Kind.INVALID,assertThrows(ResourceException.class,()->resources().registerDataset(actor,"lab",data,"v1",new DatasetVersion(data,"v1","pt",List.of(new Location(a,uri))))).kind());
        }
        assertThrows(ResourceException.class,()->resourceDataset(data,"v1","pt",a,a));
        assertThrows(ResourceException.class,()->resourceDataset(data,"../v1","pt",a));
        assertThrows(ResourceException.class,()->resources().putCluster(actor,"lab",a,new Cluster(a, null,true)));
        assertThrows(ResourceException.class,()->resources().placementOptions(actor,"lab",new PlacementRequest(List.of(a,a),List.of())));
        assertThrows(ResourceException.class,()->resources().placementOptions(actor,"lab",new PlacementRequest(List.of(),List.of())));
        resourceDataset(data,"v1","pt",a);
        var required=new DatasetRequirement(data,"v1",null);
        assertThrows(ResourceException.class,()->resources().placementOptions(actor,"lab",new PlacementRequest(List.of(a),List.of(required,required))));
    }

    @Test void resourceHttpHonorsReadWritePermissionsAndReturnsDomainErrors() throws Exception {
        String a=id(),data=id(),base="/api/namespaces/lab/resources";
        var cluster=new Cluster(a,Kind.EDGE,true);
        assertEquals(401,call(port(),"PUT",base+"/clusters/"+a,null,cluster,null).statusCode());
        assertEquals(403,call(port(),"PUT",base+"/clusters/"+a,"viewer",cluster,null).statusCode());
        assertEquals(200,call(port(),"PUT",base+"/clusters/"+a,"writer",cluster,null).statusCode());
        assertEquals(200,call(port(),"GET",base+"/clusters/"+a,"viewer",null,null).statusCode());
        assertEquals(403,call(port(),"GET",base.replace("/lab/","/other/")+"/clusters/"+a,"writer",null,null).statusCode());
        assertEquals(422,call(port(),"PUT",base+"/clusters/"+a,"writer",new Cluster(id(),Kind.EDGE,true),null).statusCode());
        assertEquals(400,call(port(),"PUT",base+"/clusters/"+a,"writer",Map.of("id",a,"kind","EDGE","unexpected",true),null).statusCode());
        var version=new DatasetVersion(data,"v1","pt",List.of(new Location(a,"s3://datasets/data.pt")));
        String path=base+"/datasets/"+data+"/versions/v1";
        assertEquals(200,call(port(),"PUT",path,"writer",version,null).statusCode());
        assertEquals(200,call(port(),"PUT",path,"writer",version,null).statusCode());
        assertEquals(409,call(port(),"PUT",path,"writer",new DatasetVersion(data,"v1","f32",version.locations()),null).statusCode());
        assertEquals(200,call(port(),"GET",path,"viewer",null,null).statusCode());
        assertEquals(404,call(port(),"GET",path.replace("v1","missing"),"viewer",null,null).statusCode());
        var response=call(port(),"POST",base+"/placement-options","viewer",new PlacementRequest(List.of(a),List.of(new DatasetRequirement(data,"v1","pt"))),null);
        assertEquals(200,response.statusCode());assertTrue(response.body().contains("\"eligible\":true"));
    }

    @Test void resourceListsAreBoundedAndNamespaceScoped() {
        var only=new Actor("scoped",Set.of("catalog"),Set.of(Action.READ,Action.WRITE));
        for(String id:List.of("c","a","b")) resources().putCluster(only,"catalog",id,new Cluster(id,Kind.EDGE,true));
        assertEquals(List.of("b","c"),resources().clusters(only,"catalog",2,1).stream().map(Cluster::id).toList());
        resources().registerDataset(only,"catalog","data","1",new DatasetVersion("data","1","pt",List.of(new Location("a","s3://datasets/data.pt"))));
        assertEquals(1,resources().datasets(only,"catalog",20,0).size());assertTrue(resources().datasets(only,"catalog",20,1).isEmpty());
        assertThrows(ResourceException.class,()->resources().datasets(only,"catalog",101,0));
        assertThrows(ResourceException.class,()->resources().clusters(only,"catalog",20,-1));
        assertThrows(ResourceException.class,()->resources().cluster(only,"catalog","unknown"));
    }

    private String repeatSource(String id) {return "schemaVersion: 1\nnamespace: lab\nid: "+id+"\n"+"""
            tasks:
              - id: rounds
                type: core.Repeat
                repeat:
                  iterations: {source: LITERAL, value: 2}
                  initial: {value: {source: LITERAL, value: seed}}
                  feedback: {value: {source: TASK_OUTPUT, taskId: train, port: message}}
                tasks:
                  - {id: train, type: core.Log, message: '{{ outputs.rounds.value }}-x'}
                  - {id: evaluate, type: core.Log, message: '{{ taskrun.iteration }}:{{ outputs.train.message }}'}
            outputs:
              result: {source: TASK_OUTPUT, taskId: rounds, port: value}
            finally: [{id: cleanup, type: core.Log, message: cleaned}]
            """;}
    private String submitRepeat(String source,String flowId) {
        flows().save(actor,"lab",flowId,0,source);
        return executions().submit(actor,"lab",id(),new Request(flowId,null,Map.of()));
    }
    @Test void repeatFeedbackUsesNewTaskRunsAndPreservesEveryRound() {
        String flow=id(),execution=submitRepeat(repeatSource(flow),flow);drain();
        assertEquals("seed-x-x",executions().get(actor,"lab",execution).outputs().get("result"));
        var tasks=executions().tasks(actor,"lab",execution);assertEquals(6,tasks.size());
        var parent=tasks.stream().filter(t->t.taskId().equals("rounds")).findFirst().orElseThrow();
        assertEquals(2,parent.outputs().get("iterationCount"));
        var trains=tasks.stream().filter(t->t.taskId().equals("train")).toList();
        assertEquals(List.of(1,2),trains.stream().map(ExecutionRecord.TaskRun::iteration).toList());
        assertNotEquals(trains.get(0).id(),trains.get(1).id());
        for(var train:trains){assertEquals(parent.id(),train.parentTaskRunId());assertEquals(1,executions().attempts(actor,"lab",execution,train.id()).size());}
        var eval=tasks.stream().filter(t->t.taskId().equals("evaluate")).toList();
        assertEquals("1:seed-x",eval.get(0).outputs().get("message"));assertEquals("2:seed-x-x",eval.get(1).outputs().get("message"));
        assertFalse(trains.get(1).startedAt().isBefore(eval.get(0).endedAt()));
    }
    @Test void repeatRestartAtRoundBarrierDoesNotRepeatCompletedWork() {
        String flow=id(),execution=submitRepeat(repeatSource(flow),flow);
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(10)).until(()->{
            executor().processNext();worker().runOnce();
            return executions().tasks(actor,"lab",execution).stream().anyMatch(t->t.taskId().equals("rounds")&&Integer.valueOf(1).equals(t.outputs().get("iterationCount")));
        });
        var first=executions().tasks(actor,"lab",execution).stream().filter(t->t.iteration()==1).map(ExecutionRecord.TaskRun::id).toList();
        context.close();context=open();drain();
        assertEquals("seed-x-x",executions().get(actor,"lab",execution).outputs().get("result"));
        assertEquals(first,executions().tasks(actor,"lab",execution).stream().filter(t->t.iteration()==1).map(ExecutionRecord.TaskRun::id).toList());
    }
    @Test void repeatDagWaitsForBothBranchesBeforeFeedback() {
        String flow=id();String source=repeatSource(flow).replace("- {id: train, type: core.Log, message: '{{ outputs.rounds.value }}-x'}\n      - {id: evaluate, type: core.Log, message: '{{ taskrun.iteration }}:{{ outputs.train.message }}'}", """
                - id: dag
                        type: core.Dag
                        tasks:
                          - {id: evaluate, type: core.Log, dependsOn: [train, peer], message: '{{ outputs.train.message }}:{{ outputs.peer.message }}'}
                          - {id: train, type: core.Log, message: '{{ outputs.rounds.value }}-x'}
                          - {id: peer, type: core.Log, message: '{{ taskrun.iteration }}'}""");
        assertTrue(source.contains("type: core.Dag"));
        String execution=submitRepeat(source,flow);drain();assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",execution).state());
        var tasks=executions().tasks(actor,"lab",execution);var eval=tasks.stream().filter(t->t.taskId().equals("evaluate")).toList();
        assertEquals("seed-x:1",eval.get(0).outputs().get("message"));assertEquals("seed-x-x:2",eval.get(1).outputs().get("message"));
        assertFalse(tasks.stream().filter(t->t.taskId().equals("train")&&t.iteration()==2).findFirst().orElseThrow().startedAt().isBefore(eval.get(0).endedAt()));
    }
    @Test void repeatLeafRetryIsNotAnotherRoundAndFailedRoundStops() {
        String flow=id(),source=repeatSource(flow).replace("type: core.Log, message: '{{ outputs.rounds.value }}-x'","type: core.Log, retry: {type: constant, maxAttempts: 2, interval: PT0.01S}, message: \"{{ taskrun.attemptsCount == 1 ? missing : outputs.rounds.value ~ '-x' }}\"");
        String execution=submitRepeat(source,flow);drain();assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",execution).state());
        for(var train:executions().tasks(actor,"lab",execution))if(train.taskId().equals("train"))assertEquals(2,executions().attempts(actor,"lab",execution,train.id()).size());
        flow=id();execution=submitRepeat(repeatSource(flow).replace("{{ outputs.rounds.value }}-x","{{ missing }}"),flow);drain();
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",execution).state());
        assertTrue(executions().tasks(actor,"lab",execution).stream().noneMatch(t->t.iteration()==2));
    }
    @Test void repeatCancellationSkipsFutureRoundsAndRunsFinally() {
        String flow=id(),execution=submitRepeat(repeatSource(flow),flow);
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(10)).until(()->{
            executor().processNext();return executions().tasks(actor,"lab",execution).stream().anyMatch(t->t.iteration()==1&&t.state()==ExecutionState.RUNNING);
        });
        executions().cancel(actor,"lab",execution);drain();assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",execution).state());
        assertTrue(executions().tasks(actor,"lab",execution).stream().noneMatch(t->t.iteration()==2));
        assertEquals(ExecutionState.SUCCESS,executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("cleanup")).findFirst().orElseThrow().state());
    }
    @Test void repeatInvalidCountFailsWithoutCreatingChildren() {
        for(String count:List.of("0","101","1.5","'two'")) {
            String flow=id(),execution=submitRepeat(repeatSource(flow).replace("value: 2}","value: "+count+"}"),flow);drain();
            assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",execution).state());
            assertTrue(executions().tasks(actor,"lab",execution).stream().noneMatch(t->t.iteration()>0));
        }
    }
    private String loopSource(String flow) {return "schemaVersion: 1\nnamespace: lab\nid: "+flow+"\n"+"""
            inputs:
              items: {type: ARRAY, defaultValue: [a, a, c, d]}
            tasks:
              - id: each
                type: core.Loop
                loop:
                  values: {source: INPUT, name: items}
                  concurrency: 2
                  outputs:
                    messages: {source: TASK_OUTPUT, taskId: say, port: message}
                    indices: {source: ITEM, path: [index]}
                tasks:
                  - {id: say, type: core.Log, message: '{{ item.index }}:{{ item.value }}'}
            outputs:
              messages: {source: TASK_OUTPUT, taskId: each, port: messages}
              indices: {source: TASK_OUTPUT, taskId: each, port: indices}
            finally: [{id: cleanup, type: core.Log, message: cleaned}]
            """;}
    private void admitLoop(String execution,int count) {
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(10)).until(()->{
            executor().processNext();return executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("say")).count()==count;
        });
    }
    @Test void loopBoundsConcurrencyOrdersDuplicateItemsAndRestartsWithoutReplaying() {
        String flow=id(),execution=submitRepeat(loopSource(flow),flow);admitLoop(execution,2);
        var first=jobs().claim("first",30000);var second=jobs().claim("second",30000);
        assertNotNull(first);assertNotNull(second);assertNull(jobs().claim("third",30000));
        var lower=((Number)((Map<?,?>)first.job().context().get("item")).get("index")).intValue()==0?first:second;
        var upper=lower==first?second:first;
        assertEquals(Map.of("index",0,"value","a"),lower.job().context().get("item"));
        assertFalse(json.write(lower.job().context()).contains("_loopValues"));
        assertTrue(jobs().finish(upper,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","1:a"))));
        admitLoop(execution,3);
        assertEquals(ExecutionState.RUNNING,executions().get(actor,"lab",execution).state());
        var admitted=executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("say")).map(ExecutionRecord.TaskRun::id).toList();
        context.close();context=open();
        assertEquals(admitted,executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("say")).map(ExecutionRecord.TaskRun::id).toList());
        assertTrue(jobs().finish(lower,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","0:a"))));
        assertFalse(jobs().finish(upper,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","late"))));
        drain();
        assertEquals(List.of("0:a","1:a","2:c","3:d"),executions().get(actor,"lab",execution).outputs().get("messages"));
        assertEquals(List.of(0,1,2,3),executions().get(actor,"lab",execution).outputs().get("indices"));
        assertEquals(4,executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("say")).count());
    }
    @Test void loopLeafRetryKeepsItemAndFailureDrainsPeersWithoutAdmittingMore() {
        String flow=id(),execution=submitRepeat(loopSource(flow).replace("type: core.Log, message: '{{ item.index }}:{{ item.value }}'", "type: core.Log, retry: {type: constant, maxAttempts: 2, interval: PT0.01S}, message: \"{{ taskrun.attemptsCount == 1 ? missing : item.value }}\""),flow);
        drain();assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",execution).state());
        for(var run:executions().tasks(actor,"lab",execution))if(run.taskId().equals("say"))assertEquals(2,executions().attempts(actor,"lab",execution,run.id()).size());
        flow=id();execution=submitRepeat(loopSource(flow),flow);admitLoop(execution,2);
        var bad=jobs().claim("bad",30000);var slow=jobs().claim("slow",30000);
        assertTrue(jobs().finish(bad,com.project.platform.runtime.worker.WorkerJob.Result.failed("permanent item failure")));
        for(int i=0;i<10;i++){executor().processNext();pause(25);}
        assertEquals(2,executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("say")).count());
        assertEquals(ExecutionState.RUNNING,executions().get(actor,"lab",execution).state());
        assertTrue(jobs().finish(slow,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","done"))));
        drain();assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",execution).state());
        assertTrue(executions().get(actor,"lab",execution).error().contains("permanent item failure"));
    }
    @Test void loopCancellationStopsAdmittedItemsAndRunsFinallyOnlyOnce() {
        String flow=id(),execution=submitRepeat(loopSource(flow),flow);admitLoop(execution,2);
        executions().cancel(actor,"lab",execution);drain();
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",execution).state());
        var runs=executions().tasks(actor,"lab",execution);
        assertEquals(2,runs.stream().filter(t->t.taskId().equals("say")).count());
        assertTrue(runs.stream().filter(t->t.taskId().equals("say")).allMatch(t->t.state()==ExecutionState.KILLED));
        var cleanup=runs.stream().filter(t->t.taskId().equals("cleanup")).findFirst().orElseThrow();
        assertEquals(ExecutionState.SUCCESS,cleanup.state());assertEquals(1,executions().attempts(actor,"lab",execution,cleanup.id()).size());
    }
    @Test void loopEmptyAndVariableLiteralAndTaskOutputCollectionsUseExistingBindings() {
        for(String value:List.of("[]","[x,y]"))for(String source:List.of("literal","variable","output")) {
            String flow=id(),yaml=loopSource(flow);String binding;
            if(source.equals("literal"))binding="{source: LITERAL, value: "+value+"}";
            else if(source.equals("variable")) {
                yaml=yaml.replace("tasks:\n  - id: each", "variables:\n  values: {source: LITERAL, value: "+value+"}\ntasks:\n  - id: each");
                binding="{source: VARIABLE, name: values}";
            } else {
                yaml=yaml.replace("tasks:\n  - id: each", "tasks:\n  - id: seed\n    type: core.Loop\n    loop:\n      values: {source: LITERAL, value: "+value+"}\n      outputs: {values: {source: ITEM, path: [value]}}\n    tasks: [{id: echo, type: core.Log, message: seed}]\n  - id: each");
                binding="{source: TASK_OUTPUT, taskId: seed, port: values}";
            }
            String execution=submitRepeat(yaml.replace("{source: INPUT, name: items}",binding),flow);drain();
            assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",execution).state());
            assertEquals(value.equals("[]")?List.of():List.of("0:x","1:y"),executions().get(actor,"lab",execution).outputs().get("messages"));
        }
    }
    @Test void repeatLoopScopesSeparateIdenticalTaskIdsAndBarrierFeedback() {
        String flow=id(),yaml=repeatSource(flow).replace("{source: TASK_OUTPUT, taskId: train, port: message}","{source: TASK_OUTPUT, taskId: each, port: values}");
        yaml=yaml.replace("- {id: train, type: core.Log, message: '{{ outputs.rounds.value }}-x'}", """
                - id: each
                        type: core.Loop
                        loop:
                          values: {source: LITERAL, value: [a, b]}
                          concurrency: 2
                          outputs: {values: {source: TASK_OUTPUT, taskId: train, port: message}}
                        tasks:
                          - {id: train, type: core.Log, message: '{{ item.value }}:{{ outputs.rounds.value }}'}""")
                .replace("{{ outputs.train.message }}","{{ outputs.each.values }}");
        String execution=submitRepeat(yaml,flow);drain();assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",execution).state());
        var runs=executions().tasks(actor,"lab",execution);var trains=runs.stream().filter(t->t.taskId().equals("train")).toList();
        assertEquals(4,trains.size());assertEquals(4,trains.stream().map(ExecutionRecord.TaskRun::id).distinct().count());
        assertEquals(2,trains.stream().map(ExecutionRecord.TaskRun::parentTaskRunId).distinct().count());
        assertEquals(List.of(1,2,1,2),trains.stream().map(ExecutionRecord.TaskRun::iteration).toList());
        var second=runs.stream().filter(t->t.taskId().equals("each")&&t.iteration()==2).findFirst().orElseThrow();
        assertTrue(trains.stream().filter(t->t.parentTaskRunId().equals(second.id())).allMatch(t->t.outputs().get("message").toString().contains("seed")));
    }
    @Test void loopFailureInsideParallelGroupStopsNewItemsWhileSiblingDrains() {
        String flow=id(),yaml=loopSource(flow).replace("- {id: say, type: core.Log, message: '{{ item.index }}:{{ item.value }}'}", """
                - id: pair
                        type: core.Parallel
                        tasks:
                          - {id: say, type: core.Log, message: '{{ item.value }}'}
                          - {id: peer, type: core.Log, message: peer}""");
        String execution=submitRepeat(yaml,flow);admitLoop(execution,2);
        var leases=new ArrayList<com.project.platform.runtime.worker.WorkerJob.Lease>();
        for(int i=0;i<4;i++)leases.add(Objects.requireNonNull(jobs().claim("worker-"+i,30000)));
        var bad=leases.stream().filter(l->l.job().task().id().equals("say")&&Integer.valueOf(0).equals(((Map<?,?>)l.job().context().get("item")).get("index"))).findFirst().orElseThrow();
        for(var lease:leases)if(lease==bad)assertTrue(jobs().finish(lease,com.project.platform.runtime.worker.WorkerJob.Result.failed("nested failure")));
        else if(Integer.valueOf(1).equals(((Map<?,?>)lease.job().context().get("item")).get("index")))assertTrue(jobs().finish(lease,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","ok"))));
        for(int i=0;i<10;i++){executor().processNext();pause(25);}
        assertEquals(2,executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("say")).count());
        assertEquals(ExecutionState.RUNNING,executions().get(actor,"lab",execution).state());
        var pending=leases.stream().filter(l->l.job().task().id().equals("peer")&&Integer.valueOf(0).equals(((Map<?,?>)l.job().context().get("item")).get("index"))).findFirst().orElseThrow();
        assertTrue(jobs().finish(pending,com.project.platform.runtime.worker.WorkerJob.Result.success(Map.of("message","drained"))));
        drain();assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",execution).state());
    }
    @Test void loopMigrationRequiresOfflineUpgradePreservesHistoryAndEnforcesRootScope() throws Exception {
        var created=mysql.execInContainer("mysql","-uroot","-p"+mysql.getPassword(),"-e",
                "CREATE DATABASE s5_loop_upgrade_test; GRANT ALL ON s5_loop_upgrade_test.* TO 'backend_test'@'%';");
        assertEquals(0,created.getExitCode(),created.getStderr());
        String url=mysql.getJdbcUrl().replace("/backend_s1_test","/s5_loop_upgrade_test");
        org.flywaydb.core.Flyway.configure().dataSource(url,mysql.getUsername(),mysql.getPassword())
                .locations("classpath:db/migration/runtime","classpath:db/migration/dataflow").target("10").load().migrate();
        var oldDb=new JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(url,mysql.getUsername(),mysql.getPassword()));
        oldDb.update("INSERT INTO wf_execution(id,namespace,flow_id,flow_revision,submitted_by,request_key,request_hash,state,definition_json,inputs_json,variables_json,outputs_json,created_at) VALUES('history','lab','old',1,'writer','old-key',?,'RUNNING','{}','{}','{}','{}',CURRENT_TIMESTAMP(6))","c".repeat(64));
        oldDb.update("INSERT INTO wf_task_run(id,execution_id,task_id,task_index,state,outputs_json,phase,iteration) VALUES('root','history','each',0,'SUCCESS','{}','MAIN',0)");
        var upgrade=org.flywaydb.core.Flyway.configure().dataSource(url,mysql.getUsername(),mysql.getPassword())
                .locations("classpath:db/migration/runtime","classpath:db/migration/dataflow").load();
        assertThrows(org.flywaydb.core.api.FlywayException.class,upgrade::migrate);
        oldDb.update("UPDATE wf_execution SET state='SUCCESS',main_state='SUCCESS' WHERE id='history'");
        upgrade.repair();upgrade.migrate(); // Only the deliberately failed disposable test schema.
        assertEquals("SUCCESS",oldDb.queryForObject("SELECT state FROM wf_task_run WHERE id='root'",String.class));
        assertThrows(DataAccessException.class,()->oldDb.update("INSERT INTO wf_task_run(id,execution_id,task_id,task_index,state,outputs_json,phase,iteration) VALUES('duplicate','history','each',1,'SUCCESS','{}','MAIN',0)"));
    }
    @Test void fortyItemsUseOneDefinitionAndRuntimeRejectsOversizedCollection() {
        String flow=id();flows().save(actor,"lab",flow,0,loopSource(flow).replace("concurrency: 2","concurrency: 10"));
        var items=java.util.stream.IntStream.range(0,40).mapToObj(i->"client-"+i).toList();
        String execution=executions().submit(actor,"lab",id(),new Request(flow,null,Map.of("items",items)));drain();
        assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",execution).state());
        assertEquals(3,executions().get(actor,"lab",execution).definition().allTasks().size());
        var runs=executions().tasks(actor,"lab",execution).stream().filter(t->t.taskId().equals("say")).toList();
        assertEquals(40,runs.size());assertEquals(40,runs.stream().map(ExecutionRecord.TaskRun::id).distinct().count());
        assertEquals(java.util.stream.IntStream.range(0,40).boxed().toList(),executions().get(actor,"lab",execution).outputs().get("indices"));
        execution=executions().submit(actor,"lab",id(),new Request(flow,null,Map.of("items",Collections.nCopies(1001,"x"))));drain();
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",execution).state());
        assertTrue(executions().tasks(actor,"lab",execution).stream().noneMatch(t->t.taskId().equals("say")));
    }
    private void awaitChild(Process child,int port) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(30);
        while(System.nanoTime()<deadline) {
            assertTrue(child.isAlive(),"child exited; see target/restart-evidence");
            try { if(call(port,"GET","/api/namespaces/lab/flows","writer",null,null).statusCode()==200) return; }
            catch(java.io.IOException ignored) { }
            Thread.sleep(100);
        }
        fail("child did not become ready; see target/restart-evidence");
    }
}

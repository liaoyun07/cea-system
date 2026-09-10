package com.project.platform.server;

import com.project.platform.dataflow.definition.*;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.executor.FlowExecutor;
import com.project.platform.runtime.model.*;
import com.project.platform.runtime.worker.WorkerEngine;
import java.net.*;
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
import org.testcontainers.containers.MySQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class FlowManagementTest {
    private final MySQLContainer<?> mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("flow_editor_test")
            .withUsername("test").withPassword("isolated-test-only").withUrlParam("connectionTimeZone","UTC");
    private ConfigurableApplicationContext context;
    private final JsonCodec json=new JsonCodec();
    private final FlowParser parser=new FlowParser(new FlowValidator(new TemplateRenderer()));
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final Actor actor=new Actor("writer",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private final String base="/api/namespaces/lab/flows";
    @BeforeAll void start() {
        mysql.start();
        try {
            context=new SpringApplicationBuilder(BackendApplication.class).run("--server.port=0",
                    "--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false",
                    "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),"--spring.datasource.password="+mysql.getPassword(),
                    "--platform.security.users[0].name=writer","--platform.security.users[0].password=test-password","--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE",
                    "--platform.security.users[1].name=viewer","--platform.security.users[1].password=test-password","--platform.security.users[1].namespaces=lab","--platform.security.users[1].actions=READ",
                    "--platform.security.users[2].name=editor","--platform.security.users[2].password=test-password","--platform.security.users[2].namespaces=lab","--platform.security.users[2].actions=READ,WRITE",
                    "--logging.level.root=WARN");
        } catch(RuntimeException failure) {mysql.stop();throw failure;}
    }
    @AfterAll void stop() {if(context!=null)context.close();mysql.stop();}
    private FlowService flows(){return context.getBean(FlowService.class);}
    private JdbcTemplate jdbc(){return context.getBean(JdbcTemplate.class);}
    private String id(){return "f"+UUID.randomUUID().toString().replace("-","");}
    private String source(String id) {
        return """
                # preserve this comment in source exports；中文注释
                schemaVersion: 1
                namespace: lab
                id: %s
                description: 编辑与导出验证
                inputs:
                  name: {type: STRING, required: true}
                  count: {type: INTEGER, defaultValue: 2}
                variables:
                  who: {source: INPUT, name: name}
                tasks:
                  - {id: hello, type: core.Log, message: "Hello {{ vars.who }}; {{ inputs.count }}"}
                outputs:
                  result: {source: TASK_OUTPUT, taskId: hello, port: message}
                """.formatted(id);
    }
    private HttpResponse<String> call(String method,String path,String user,Object body) throws Exception {
        return call(method,path,user,body,null);
    }
    private HttpResponse<String> call(String method,String path,String user,Object body,String key) throws Exception {
        int port=context.getBean(Environment.class).getProperty("local.server.port",Integer.class);
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(15));
        if(user!=null)request.header("Authorization","Basic "+Base64.getEncoder().encodeToString((user+":test-password").getBytes(StandardCharsets.UTF_8)));
        if(key!=null)request.header("Idempotency-Key",key);
        request.header("Content-Type","application/json").method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.write(body)));
        return http.send(request.build(),HttpResponse.BodyHandlers.ofString());
    }
    private Map<String,Object> entry(int revision,String source){return Map.of("expectedRevision",revision,"source",source);}
    private int count(String table){return jdbc().queryForObject("SELECT COUNT(*) FROM "+table,Integer.class);}

    @Test void namespaceFilesHavePinnedVersionsCasAndPermissions() throws Exception {
        String path="scripts/"+id()+".sh",api="/api/namespaces/lab/files";
        var request=Map.of("path",path,"expectedRevision",0,"content","echo 第一版");
        assertEquals(401,call("POST",api,null,request).statusCode());
        assertEquals(403,call("POST",api,"viewer",request).statusCode());
        assertEquals(201,call("POST",api,"writer",request).statusCode());
        assertEquals(409,call("POST",api,"writer",request).statusCode());
        assertEquals(201,call("POST",api,"writer",Map.of("path",path,"expectedRevision",1,"content","echo second")).statusCode());
        var first=call("GET",api+"/revision?path="+path+"&revision=1","viewer",null);
        assertEquals(200,first.statusCode());assertEquals("echo 第一版",json.map(first.body()).get("content"));
        assertEquals(404,call("GET",api+"/revision?path="+path+"&revision=3","viewer",null).statusCode());
        assertEquals(403,call("GET",api.replace("/lab/","/other/")+"/revision?path="+path+"&revision=1","writer",null).statusCode());
        assertTrue(call("GET",api,"viewer",null).body().contains(path));
        for(String invalid:List.of("../secret","a/../secret","/absolute","a//b","a/","a\\b","a/./b"))
            assertEquals(422,call("POST",api,"writer",Map.of("path",invalid,"expectedRevision",0,"content","")).statusCode());
        assertEquals(422,call("POST",api,"writer",Map.of("path",path,"expectedRevision",2,"content","中".repeat(22000))).statusCode());
    }
    @Test void concurrentNamespaceFileUpdatesHaveOneWinner() throws Exception {
        var files=context.getBean(NamespaceFileService.class);String path=id();files.save(actor,"lab",path,0,"initial");
        var gate=new CountDownLatch(1);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var futures=new ArrayList<Future<Boolean>>();
            for(int n=0;n<2;n++)futures.add(pool.submit(()->{gate.await();try {files.save(actor,"lab",path,1,"next");return true;}
                catch(WorkflowException ex){assertEquals(WorkflowException.Kind.CONFLICT,ex.kind());return false;}}));
            gate.countDown();int winners=0;for(var f:futures)if(f.get(5,TimeUnit.SECONDS))winners++;assertEquals(1,winners);
        }
        assertEquals("initial",files.get(actor,"lab",path,1).content());
    }
    private FlowExecutionService executions(){return context.getBean(FlowExecutionService.class);}
    private String submitBody(String body) {
        String name=id();flows().save(actor,"lab",name,0,"schemaVersion: 1\nnamespace: lab\nid: "+name+"\n"+body);
        return executions().submit(actor,"lab",id(),new FlowExecutionService.Request(name,null,Map.of()));
    }
    private void drain(String execution) throws Exception {
        long end=System.nanoTime()+Duration.ofSeconds(12).toNanos();
        while(System.nanoTime()<end) {
            context.getBean(FlowExecutor.class).processNext();context.getBean(WorkerEngine.class).runOnce();
            if(executions().get(actor,"lab",execution).state().terminal()
                    && executions().tasks(actor,"lab",execution).stream().allMatch(t->t.state().terminal()))return;
            Thread.sleep(15);
        }
        fail("execution or afterExecution did not drain: "+execution);
    }
    @Test void checksBlockPreviewEverySubmissionFacadeAndUndefinedExpressions() throws Exception {
        String name=id(),source=source(name)+"checks: [{when: '{{ inputs.count > 3 }}', message: 'count must exceed three'}]\n";
        flows().save(actor,"lab",name,0,source);int before=count("wf_execution");
        assertEquals(422,call("POST",base+"/"+name+"/preview","writer",Map.of("source",source,"inputs",Map.of("name","Ada"))).statusCode());
        var request=new FlowExecutionService.Request(name,null,Map.of("name","Ada"));
        assertThrows(WorkflowException.class,()->executions().submit(actor,"lab",id(),request));
        var revision=flows().get(actor,"lab",name,null);
        assertThrows(WorkflowException.class,()->context.getBean(com.project.platform.runtime.execution.ExecutionService.class)
                .submit(revision.definition(),1,"writer",id(),"hash",new BindingResolver().prepare(revision.definition(),request.inputs())));
        String policy=id();flows().savePolicy(actor,"lab",policy,0,source.replace("id: "+name,"id: "+policy));
        assertThrows(WorkflowException.class,()->executions().submitPolicy(actor,"lab",id(),new FlowExecutionService.Request(policy,null,request.inputs())));
        assertEquals(before,count("wf_execution"));
        for(String condition:List.of("yes","{{ inputs.absent }}")) {
            var invalid=parser.parse(source.replace("{{ inputs.count > 3 }}",condition));
            assertThrows(WorkflowException.class,()->new BindingResolver().checks(invalid,new BindingResolver().prepare(invalid,request.inputs())));
        }
        String run=executions().submit(actor,"lab",id(),new FlowExecutionService.Request(name,null,Map.of("name","Ada","count",4)));
        drain(run);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",run).state());
    }
    @Test void rejectedScheduleCheckAdvancesWithoutCreatingExecution() {
        String name=id();flows().save(actor,"lab",name,0,"schemaVersion: 1\nnamespace: lab\nid: "+name+"\n"+
                "tasks: [{id: log, type: core.Log, message: hello}]\nchecks: [{when: 'false', message: no}]\nschedule: {cron: '0 0 0 * * *'}\n");
        jdbc().update("UPDATE wf_schedule SET next_fire=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE flow_id=?",name);
        int before=count("wf_execution");assertTrue(context.getBean(com.project.platform.runtime.scheduler.SchedulerEngine.class).runOnce());
        assertEquals(before,count("wf_execution"));
        assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM wf_schedule WHERE flow_id=? AND next_fire>CURRENT_TIMESTAMP(6)",Integer.class,name));
    }
    @Test void webhookIsOptInAuthenticatedGatedAndIdempotentAcrossEdits() throws Exception {
        String name=id(),route="/api/namespaces/lab/webhooks/"+name,key=id();flows().save(actor,"lab",name,0,source(name));
        Map<String,Object> inputs=Map.of("name","Ada");
        assertEquals(401,call("POST",route,null,inputs,key).statusCode());assertEquals(403,call("POST",route,"viewer",inputs,key).statusCode());
        assertEquals(422,call("POST",route,"writer",inputs,key).statusCode());
        flows().save(actor,"lab",name,1,source(name)+"webhook: true\nchecks: [{when: '{{ inputs.count > 0 }}', message: positive}]\n");
        assertEquals(400,call("POST",route,"writer",inputs).statusCode());
        assertEquals(422,call("POST",route,"writer",Map.of("name","Ada","count",0),id()).statusCode());
        var first=call("POST",route,"writer",inputs,key);assertEquals(202,first.statusCode(),first.body());
        String execution=(String)json.map(first.body()).get("executionId");
        assertEquals(first.body(),call("POST",route,"writer",inputs,key).body());
        assertEquals(409,call("POST",route,"writer",Map.of("name","different"),key).statusCode());
        flows().save(actor,"lab",name,2,source(name)+"webhook: false\n");
        assertEquals(first.body(),call("POST",route,"writer",inputs,key).body());
        assertEquals(422,call("POST",route,"writer",inputs,id()).statusCode());
        assertThrows(WorkflowException.class,()->executions().submit(actor,"lab","webhook:"+id(),new FlowExecutionService.Request(name,null,inputs)));
        drain(execution);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",execution).state());
    }
    @Test void slaAndAfterExecutionPreserveMainResultOutputsAndEndTime() throws Exception {
        String execution=submitBody("""
                tasks: [{id: main, type: core.Log, message: original}]
                outputs: {value: {source: TASK_OUTPUT, taskId: main, port: message}}
                sla: {maxDuration: PT0.001S}
                afterExecution:
                  - {id: broken, type: core.Log, message: '{{ inputs.missing }}', retry: {type: constant, maxAttempts: 2, interval: PT0.001S}}
                  - {id: notify, type: core.Log, message: '{{ execution.state }} {{ execution.outputs.value }} {{ execution.slaViolated }}'}
                """);
        while(!executions().get(actor,"lab",execution).state().terminal()) {
            context.getBean(FlowExecutor.class).processNext();context.getBean(WorkerEngine.class).runOnce();Thread.sleep(10);
        }
        var completed=executions().get(actor,"lab",execution);assertEquals(ExecutionState.SUCCESS,completed.state());assertNotNull(completed.slaViolatedAt());
        executions().cancel(actor,"lab",execution);drain(execution);
        assertEquals(completed,executions().get(actor,"lab",execution));
        var tasks=executions().tasks(actor,"lab",execution);
        assertEquals(ExecutionState.FAILED,tasks.get(1).state());assertEquals(2,executions().attempts(actor,"lab",execution,tasks.get(1).id()).size());
        assertEquals("SUCCESS original true",tasks.get(2).outputs().get("message"));
        assertEquals(FlowDefinition.Phase.AFTER_EXECUTION,tasks.get(2).phase());
        assertFalse(tasks.get(2).startedAt().isBefore(completed.endedAt()));
    }
    @Test void failedAndCancelledExecutionsStillRunAfterFinally() throws Exception {
        for(boolean cancel:List.of(false,true)) {
            String execution=submitBody("tasks: [{id: main, type: core.Log, message: '{{ inputs.missing }}'}]\n"+
                    "finally: [{id: cleanup, type: core.Log, message: cleaned}]\n"+
                    "afterExecution: [{id: notify, type: core.Log, message: '{{ execution.state }} {{ outputs.cleanup.message }}'}]\n");
            if(cancel)executions().cancel(actor,"lab",execution);
            drain(execution);var tasks=executions().tasks(actor,"lab",execution);
            assertEquals(cancel?ExecutionState.KILLED:ExecutionState.FAILED,executions().get(actor,"lab",execution).state());
            assertEquals((cancel?"KILLED":"FAILED")+" cleaned",tasks.get(2).outputs().get("message"));
        }
    }
    @Test void terminalAfterTaskLeaseIsRecoveredWithoutChangingMainOutcome() throws Exception {
        String execution=submitBody("tasks: [{id: main, type: core.Log, message: main}]\n"+
                "afterExecution: [{id: notify, type: core.Log, message: '{{ execution.state }}'}]\n");
        long deadline=System.nanoTime()+Duration.ofSeconds(8).toNanos();
        while(!executions().get(actor,"lab",execution).state().terminal() && System.nanoTime()<deadline) {
            context.getBean(FlowExecutor.class).processNext();context.getBean(WorkerEngine.class).runOnce();Thread.sleep(10);
        }
        var completed=executions().get(actor,"lab",execution);assertTrue(completed.state().terminal());
        var transport=context.getBean(com.project.platform.runtime.persistence.JdbcWorkerStore.class);
        var store=context.getBean(com.project.platform.runtime.persistence.JdbcExecutionStore.class);
        var restarted=new FlowExecutor(store,transport,new BindingResolver(),new TemplateRenderer(),new com.project.platform.runtime.executor.ExecutionReducer());
        while(executions().tasks(actor,"lab",execution).get(1).state()==ExecutionState.CREATED && System.nanoTime()<deadline) {restarted.processNext();Thread.sleep(10);}
        var lease=transport.claim("dead-worker",1000);assertNotNull(lease);assertEquals("notify",lease.job().task().id());
        jdbc().update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",lease.job().taskRunId());
        try(var worker=new WorkerEngine(transport,new TemplateRenderer(),1000,context.getBean(com.project.platform.runtime.worker.TaskRunner.class))) {
            assertTrue(worker.runOnce());
            assertFalse(transport.finish(lease,com.project.platform.runtime.worker.WorkerJob.Result.failed("stale")));
        }
        drain(execution);assertEquals(completed,executions().get(actor,"lab",execution));
        assertEquals(1,executions().attempts(actor,"lab",execution,lease.job().taskRunId()).size());
        assertEquals("SUCCESS",executions().tasks(actor,"lab",execution).get(1).outputs().get("message"));
    }
    @Test void slaIsDurableAcrossExecutorRecreationAndDoesNotCountQueueOrAfterTime() throws Exception {
        String execution=submitBody("tasks: [{id: main, type: core.Log, message: main}]\nsla: {maxDuration: PT1S}\n"+
                "afterExecution: [{id: notify, type: core.Log, message: '{{ execution.slaViolated }}'}]\n");
        while(executions().get(actor,"lab",execution).startedAt()==null)context.getBean(FlowExecutor.class).processNext();
        jdbc().update("UPDATE wf_execution SET started_at=TIMESTAMPADD(SECOND,-2,CURRENT_TIMESTAMP(6)) WHERE id=?",execution);
        var restarted=new FlowExecutor(context.getBean(com.project.platform.runtime.persistence.JdbcExecutionStore.class),
                context.getBean(com.project.platform.runtime.persistence.JdbcWorkerStore.class),new BindingResolver(),new TemplateRenderer(),new com.project.platform.runtime.executor.ExecutionReducer());
        restarted.processNext();drain(execution);
        var violated=executions().get(actor,"lab",execution);assertNotNull(violated.slaViolatedAt());assertEquals(ExecutionState.SUCCESS,violated.state());
        assertEquals("true",executions().tasks(actor,"lab",execution).get(1).outputs().get("message"));
        String fast=submitBody("tasks: [{id: main, type: core.Log, message: main}]\nsla: {maxDuration: PT1S}\n"+
                "afterExecution: [{id: slow, type: core.Sleep, duration: PT1.1S, timeout: PT3S}]\n");
        jdbc().update("UPDATE wf_execution SET created_at=TIMESTAMPADD(SECOND,-5,CURRENT_TIMESTAMP(6)) WHERE id=?",fast);
        drain(fast);assertNull(executions().get(actor,"lab",fast).slaViolatedAt());
    }
    @Test void queuedCancellationAndAdmissionRejectionRunOnlyAfterTasks() throws Exception {
        for(String behavior:List.of("QUEUE","FAIL")) {
            String name=id(),source="schemaVersion: 1\nnamespace: lab\nid: "+name+"\nconcurrency: {limit: 1, behavior: "+behavior+"}\n"+
                    "tasks: [{id: main, type: core.Log, message: original}]\nfinally: [{id: cleanup, type: core.Log, message: cleaned}]\n"+
                    "afterExecution: [{id: notify, type: core.Log, message: '{{ execution.state }}'}]\n";
            flows().save(actor,"lab",name,0,source);
            var request=new FlowExecutionService.Request(name,null,Map.of());String active=executions().submit(actor,"lab",id(),request);
            String queued=executions().submit(actor,"lab",id(),request);
            if(behavior.equals("QUEUE"))executions().cancel(actor,"lab",queued);
            drain(queued);drain(active);
            var tasks=executions().tasks(actor,"lab",queued);assertEquals(ExecutionState.SKIPPED,tasks.get(0).state());assertEquals(ExecutionState.SKIPPED,tasks.get(1).state());
            assertEquals(ExecutionState.SUCCESS,tasks.get(2).state());
        }
    }

    @Test void schemaReflectsRuntimeFieldsAliasesAndBindingVariants() throws Exception {
        var response=call("GET",base+"/editor/schema","viewer",null);assertEquals(200,response.statusCode(),response.body());
        var schema=json.map(response.body());var defs=(Map<?,?>)schema.get("$defs");
        assertEquals("https://json-schema.org/draft/2020-12/schema",schema.get("$schema"));
        for(var type:List.of(FlowDefinition.class,FlowDefinition.Task.class,FlowDefinition.Container.class,FlowDefinition.Repeat.class,FlowDefinition.Loop.class)) {
            var properties=(Map<?,?>)((Map<?,?>)defs.get(type.getSimpleName())).get("properties");
            var names=new TreeSet<String>();
            for(var component:type.getRecordComponents()) {
                var alias=component.getAccessor().getAnnotation(com.fasterxml.jackson.annotation.JsonProperty.class);
                names.add(alias==null?component.getName():alias.value());
            }
            assertEquals(names,properties.keySet());
        }
        assertEquals(5,((List<?>)((Map<?,?>)defs.get("Binding")).get("oneOf")).size());
        assertTrue(response.body().contains("TASK_OUTPUT"));assertTrue(response.body().contains("ITEM"));
        assertTrue(response.body().contains("core.Loop"));assertFalse(response.body().contains("finallyTasks"));
        checkReferences(schema,defs);
    }
    private void checkReferences(Object value,Map<?,?> definitions) {
        if(value instanceof Map<?,?> map) {
            if(map.get("$ref") instanceof String ref) {assertTrue(ref.startsWith("#/$defs/"));assertTrue(definitions.containsKey(ref.substring(8)),ref);}
            map.values().forEach(item->checkReferences(item,definitions));
        } else if(value instanceof List<?> list)list.forEach(item->checkReferences(item,definitions));
    }
    @Test void validateAndPreviewAreSideEffectFreeAndUseExecutionInputs() throws Exception {
        String id=id(),source=source(id);int revisions=count("wf_flow_revision"),executions=count("wf_execution"),schedules=count("wf_schedule");
        var validation=call("POST",base+"/"+id+"/validate","writer",Map.of("source",source));assertEquals(200,validation.statusCode(),validation.body());
        assertEquals(parser.parse(source),json.flow(validation.body()));
        var preview=call("POST",base+"/"+id+"/preview","writer",Map.of("source",source,"inputs",Map.of("name","Ada")));
        assertEquals(200,preview.statusCode(),preview.body());
        var result=json.map(preview.body());assertEquals(Map.of("name","Ada","count",2),result.get("inputs"));assertEquals(Map.of("who","Ada"),result.get("variables"));
        assertFalse(result.containsKey("outputs"));assertFalse(result.containsKey("executionId"));
        assertEquals(revisions,count("wf_flow_revision"));assertEquals(executions,count("wf_execution"));assertEquals(schedules,count("wf_schedule"));
        for(var inputs:List.of(Map.of(),Map.of("name",3),Map.of("name","Ada","unknown",1)))
            assertEquals(422,call("POST",base+"/"+id+"/preview","writer",Map.of("source",source,"inputs",inputs)).statusCode());
    }
    @Test void editorAndSaveRejectTheSameInvalidSource() throws Exception {
        String id=id(),good=source(id);
        for(String invalid:List.of("",good+"\nunknown: true",good+"\nid: duplicate",good+"\n---\n"+good,
                good.replace("source: INPUT, name: name","source: VARIABLE, name: who"),good.replace("type: core.Log","type: imaginary.Task"),
                good.replace("taskId: hello","taskId: absent"),good.replace("namespace: lab","namespace: other"))) {
            var validation=call("POST",base+"/"+id+"/validate","writer",Map.of("source",invalid));
            var save=call("POST",base+"/"+id+"/revisions","writer",entry(0,invalid));
            assertEquals(422,validation.statusCode(),validation.body());assertEquals(validation.body(),save.body());
        }
    }
    @Test void exportEditImportAndExecuteUseOneDefinition() throws Exception {
        String oldId=id(),newId=id(),original=source(oldId);flows().save(actor,"lab",oldId,0,original);
        flows().save(actor,"lab",oldId,1,original.replace("Hello","Welcome"));
        assertEquals(original,call("GET",base+"/"+oldId+"/export?revision=1","viewer",null).body());
        for(String format:List.of("yaml","json")) {
            var response=call("GET",base+"/"+oldId+"/export?revision=1&format="+format,"viewer",null);
            assertEquals(200,response.statusCode(),response.body());assertEquals(parser.parse(original),parser.parse(response.body()));
        }
        String exported=call("GET",base+"/"+oldId+"/export?revision=1&format=json","viewer",null).body();
        var edited=new LinkedHashMap<>(json.map(exported));edited.put("id",newId);
        var imports=call("POST",base+"/import","writer",Map.of("flows",List.of(entry(0,json.write(edited)))));
        assertEquals(201,imports.statusCode(),imports.body());
        var executions=context.getBean(FlowExecutionService.class);
        String executionId=executions.submit(actor,"lab",id(),new FlowExecutionService.Request(newId,null,Map.of("name","Ada")));
        for(int n=0;n<20 && !executions.get(actor,"lab",executionId).state().terminal();n++) {
            context.getBean(FlowExecutor.class).processNext();context.getBean(WorkerEngine.class).runOnce();
        }
        var execution=executions.get(actor,"lab",executionId);assertEquals(ExecutionState.SUCCESS,execution.state(),execution.error());
        assertEquals("Hello Ada; 2",execution.outputs().get("result"));
        assertEquals(422,call("GET",base+"/"+oldId+"/export?format=zip","viewer",null).statusCode());
        assertEquals(404,call("GET",base+"/"+oldId+"/export?revision=99","viewer",null).statusCode());
    }
    @Test void importConflictRollsBackEarlierFlowAndSchedulerWrites() throws Exception {
        String a="a"+id(),z="z"+id();flows().save(actor,"lab",z,0,source(z));
        String scheduled=source(a)+"\nschedule: {cron: '0 * * * * *', inputs: {name: Ada}}\n";
        int heads=count("wf_flow_head"),revisions=count("wf_flow_revision"),schedules=count("wf_schedule");
        var response=call("POST",base+"/import","writer",Map.of("flows",List.of(entry(0,scheduled),entry(0,source(z)))));
        assertEquals(409,response.statusCode(),response.body());
        assertEquals(heads,count("wf_flow_head"));assertEquals(revisions,count("wf_flow_revision"));assertEquals(schedules,count("wf_schedule"));
        assertEquals(1,flows().get(actor,"lab",z,null).revision());
    }
    @Test void importsCannotCrossNamespaceOrTakeOverPolicyFlows() throws Exception {
        String a="a"+id(),z="z"+id();flows().savePolicy(actor,"lab",z,0,source(z));
        var response=call("POST",base+"/import","writer",Map.of("flows",List.of(entry(0,source(a)),entry(1,source(z)))));
        assertEquals(409,response.statusCode(),response.body());
        assertThrows(WorkflowException.class,()->flows().get(actor,"lab",a,null));assertEquals(1,flows().getPolicy(actor,"lab",z,null).revision());
        response=call("POST",base+"/import","writer",Map.of("flows",List.of(entry(0,source(a)),entry(0,source(z).replace("namespace: lab","namespace: other")))));
        assertEquals(422,response.statusCode(),response.body());assertThrows(WorkflowException.class,()->flows().get(actor,"lab",a,null));
        assertEquals(409,call("GET",base+"/"+z+"/export","viewer",null).statusCode());
    }
    @Test void searchFiltersLatestUserFlowsWithoutSqlWildcardInterpretation() throws Exception {
        String a=id(),b=id(),policy=id(),tag=id();String label="\nlabels: {group: '"+tag+"', \"quote.key\": \"a'b\"}\n";
        flows().save(actor,"lab",a,0,source(a).replace("description: 编辑与导出验证","description: 'needle%_exact'")+label);
        flows().save(actor,"lab",b,0,source(b)+label);flows().savePolicy(actor,"lab",policy,0,source(policy)+label);
        assertEquals(List.of(a),flows().search(actor,"lab","%_",null,null,20,0).stream().map(FlowRevision.Summary::flowId).toList());
        assertEquals(2,flows().search(actor,"lab",null,"group",tag,20,0).size());
        assertEquals(2,flows().search(actor,"lab",null,"quote.key","a'b",20,0).size());
        assertEquals(1,flows().search(actor,"lab",null,"group",tag,1,1).size());
        flows().save(actor,"lab",a,1,source(a).replace("description: 编辑与导出验证","description: replaced")+label);
        assertTrue(flows().search(actor,"lab","%_",null,null,20,0).isEmpty());
        var response=call("GET",base+"?labelKey=group&labelValue="+tag,"viewer",null);assertEquals(200,response.statusCode(),response.body());
        assertEquals(2,json.read(response.body(),List.class).size());
        for(String suffix:List.of("?labelKey=group","?labelValue=x","?limit=101","?offset=-1"))assertEquals(422,call("GET",base+suffix,"viewer",null).statusCode());
        assertTrue(flows().search(actor,"lab","' OR 1=1 --",null,null,20,0).isEmpty());
    }
    @Test void editorPermissionsMatchSaveAndNeverElevateSchedulePermission() throws Exception {
        String id=id(),source=source(id);var body=Map.of("source",source);
        assertEquals(401,call("GET",base+"/editor/schema",null,null).statusCode());
        assertEquals(403,call("GET","/api/namespaces/other/flows/editor/schema","writer",null).statusCode());
        for(String operation:List.of("validate","preview"))assertEquals(403,call("POST",base+"/"+id+"/"+operation,"viewer",body).statusCode());
        assertEquals(403,call("POST",base+"/import","viewer",Map.of("flows",List.of(entry(0,source)))).statusCode());
        assertEquals(200,call("POST",base+"/"+id+"/validate","editor",body).statusCode());
        String scheduled=source+"\nschedule: {cron: '0 * * * * *', inputs: {name: Ada}}\n";
        assertEquals(403,call("POST",base+"/"+id+"/validate","editor",Map.of("source",scheduled)).statusCode());
        assertEquals(403,call("POST",base+"/import","editor",Map.of("flows",List.of(entry(0,scheduled)))).statusCode());
    }
    @Test void boundedImportAndReplayDoNotSilentlyCreateRevisions() throws Exception {
        String id=id(),source=source(id);var item=entry(0,source);
        for(Object body:List.of(Map.of(),Map.of("flows",List.of()),Map.of("flows",List.of(item,item)),Map.of("flows",Collections.nCopies(21,item)),
                Map.of("flows",List.of(Map.of("source",source))),Map.of("flows",List.of(entry(-1,source)))))
            assertEquals(422,call("POST",base+"/import","writer",body).statusCode(),body.toString());
        var entries=new ArrayList<Map<String,Object>>();for(int n=0;n<5;n++)entries.add(entry(0,source(id())+"\n#"+"x".repeat(220000)));
        assertEquals(422,call("POST",base+"/import","writer",Map.of("flows",entries)).statusCode());
        assertEquals(201,call("POST",base+"/import","writer",Map.of("flows",List.of(item))).statusCode());
        assertEquals(409,call("POST",base+"/import","writer",Map.of("flows",List.of(item))).statusCode());
        assertEquals(1,flows().history(actor,"lab",id,20,0).size());
    }
    @Test void concurrentReverseOrderImportsHaveOneCasWinner() throws Exception {
        String a=id(),b=id();var first=new FlowService.ImportEntry(0,source(a));var second=new FlowService.ImportEntry(0,source(b));
        var gate=new CountDownLatch(1);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var futures=new ArrayList<Future<Boolean>>();
            for(var entries:List.of(List.of(first,second),List.of(second,first)))futures.add(pool.submit(()->{
                gate.await();try {flows().importFlows(actor,"lab",entries);return true;}
                catch(WorkflowException failure){assertEquals(WorkflowException.Kind.CONFLICT,failure.kind());return false;}
            }));
            gate.countDown();int winners=0;for(var future:futures)if(future.get(15,TimeUnit.SECONDS))winners++;
            assertEquals(1,winners);assertEquals(1,flows().get(actor,"lab",a,null).revision());assertEquals(1,flows().get(actor,"lab",b,null).revision());
        }
    }
    @Test void everyCheckedInFlowCanRoundTripThroughTheEditorFormats() throws Exception {
        try(var paths=Files.walk(Path.of("..","examples"))) {
            for(var path:paths.filter(p->p.toString().endsWith(".yaml")).toList()) {
                String source=Files.readString(path);
                if(!source.contains("schemaVersion:"))continue;
                var flow=parser.parse(source);
                assertEquals(flow,parser.parse(json.write(flow)),path.toString());
                assertEquals(flow,parser.parse(parser.yaml(flow)),path.toString());
            }
        }
    }
}

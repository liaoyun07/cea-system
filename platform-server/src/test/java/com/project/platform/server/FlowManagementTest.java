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
        int port=context.getBean(Environment.class).getProperty("local.server.port",Integer.class);
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(15));
        if(user!=null)request.header("Authorization","Basic "+Base64.getEncoder().encodeToString((user+":test-password").getBytes(StandardCharsets.UTF_8)));
        request.header("Content-Type","application/json").method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.write(body)));
        return http.send(request.build(),HttpResponse.BodyHandlers.ofString());
    }
    private Map<String,Object> entry(int revision,String source){return Map.of("expectedRevision",revision,"source",source);}
    private int count(String table){return jdbc().queryForObject("SELECT COUNT(*) FROM "+table,Integer.class);}

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

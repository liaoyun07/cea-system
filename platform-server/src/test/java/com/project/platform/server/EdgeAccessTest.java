package com.project.platform.server;

import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.edge.*;
import com.project.platform.edge.EdgeAccess.*;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.executor.FlowExecutor;
import com.project.platform.runtime.model.WorkflowException;
import com.project.platform.runtime.worker.WorkerEngine;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.MySQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class EdgeAccessTest {
    private final MySQLContainer<?> mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("edge_test")
            .withUsername("edge_test").withPassword("isolated-test-only").withUrlParam("connectionTimeZone","UTC");
    private ConfigurableApplicationContext context;
    private final JsonCodec json=new JsonCodec();
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final Actor manager=new Actor("manager",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private final Actor gateway=new Actor("gateway-a",Set.of("lab"),Set.of(Action.CONNECT));
    @BeforeAll void start() throws Exception {
        mysql.start();
        try {
            context=open();
            var resources=context.getBean(ResourceCatalogService.class);
            resources.putCluster(manager,"lab","edge-a",new Cluster("edge-a",Kind.EDGE,true));
            resources.putCluster(manager,"lab","edge-b",new Cluster("edge-b",Kind.EDGE,true));
            resources.putCluster(manager,"lab","cloud",new Cluster("cloud",Kind.CLOUD,true));
            assertEquals(200,call("manager","PUT","/edge/gateways/a",null,new GatewayRegistration("edge-a","gateway-a",true)).statusCode());
            assertEquals(200,call("manager","PUT","/edge/gateways/b",null,new GatewayRegistration("edge-b","gateway-b",true)).statusCode());
        } catch(Exception ex) { if(context!=null) context.close();mysql.stop();throw ex; }
    }
    @AfterAll void stop() { if(context!=null) context.close();mysql.stop(); }
    private ConfigurableApplicationContext open() {
        return new SpringApplicationBuilder(BackendApplication.class).run("--server.port=0","--logging.level.root=WARN",
                "--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false",
                "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),"--spring.datasource.password="+mysql.getPassword(),
                "--platform.security.users[0].name=manager","--platform.security.users[0].password=test-password","--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE",
                "--platform.security.users[1].name=gateway-a","--platform.security.users[1].password=test-password","--platform.security.users[1].namespaces=lab","--platform.security.users[1].actions=CONNECT",
                "--platform.security.users[2].name=gateway-b","--platform.security.users[2].password=test-password","--platform.security.users[2].namespaces=lab","--platform.security.users[2].actions=CONNECT");
    }
    private EdgeAccessService edge() { return context.getBean(EdgeAccessService.class); }
    private FlowService flows() { return context.getBean(FlowService.class); }
    private FlowExecutionService executions() { return context.getBean(FlowExecutionService.class); }
    private JdbcTemplate jdbc() { return context.getBean(JdbcTemplate.class); }
    private String id() { return "t"+UUID.randomUUID().toString().replace("-",""); }
    private String terminal() throws Exception {
        String id=id();assertEquals(200,call("manager","PUT","/edge/terminals/"+id,null,new TerminalRegistration("a",true)).statusCode());return id;
    }
    private String source(String id) {
        return """
                schemaVersion: 1
                namespace: lab
                id: %s
                inputs:
                  value: {type: STRING, required: true}
                tasks:
                  - {id: receive, type: core.Log, message: "{{ inputs.value }}"}
                  - {id: process, type: core.Log, message: "processed {{ outputs.receive.message }}"}
                outputs:
                  result: {source: TASK_OUTPUT, taskId: process, port: message}
                """.formatted(id);
    }
    private PolicyRequest policy(String id,int revision,boolean enabled) { return new PolicyRequest("edge-a",id,enabled,revision,source(id)); }
    private String savePolicy() { String id=id();edge().putPolicy(manager,"lab",id,policy(id,0,true));return id; }
    private FlowExecutionService.Request request(String flow) { return new FlowExecutionService.Request(flow,null,Map.of("value","sample")); }
    private HttpResponse<String> call(String user,String verb,String path,String key,Object body) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab"+path))
                .timeout(Duration.ofSeconds(15)).header("Content-Type","application/json");
        if(user!=null) builder.header("Authorization","Basic "+Base64.getEncoder().encodeToString((user+":test-password").getBytes(StandardCharsets.UTF_8)));
        if(key!=null) builder.header("Idempotency-Key",key);
        return http.send(builder.method(verb,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.write(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    private String accepted(HttpResponse<String> response) { assertEquals(202,response.statusCode(),response.body());return (String)json.map(response.body()).get("executionId"); }
    private void drain() {
        for(int i=0;i<80;i++) {
            context.getBean(FlowExecutor.class).processNext();context.getBean(WorkerEngine.class).runOnce();
            if(jdbc().queryForObject("SELECT COUNT(*) FROM wf_message",Integer.class)==0) return;
        }
        fail("messages did not drain");
    }
    @Test void workerAuthorityRequiresPersistedGatewayExecutionAndIsNamespaceScoped() throws Exception {
        String terminal=terminal(),flow=id();flows().save(manager,"lab",flow,0,source(flow));
        String execution=edge().submit(gateway,"lab",terminal,"worker-authority",request(flow));
        assertEquals(new Origin(terminal,"edge-a"),edge().executionOrigin(gateway,"lab",execution));
        var worker=edge().workerActor(gateway,"lab",execution);
        assertEquals(Set.of("lab"),worker.namespaces());assertEquals(Set.of(Action.READ,Action.EXECUTE),worker.actions());
        assertEquals(Set.of(Action.CONNECT),gateway.actions());
        assertThrows(WorkflowException.class,()->edge().workerActor(new Actor("gateway-b",Set.of("lab"),Set.of(Action.CONNECT)),"lab",execution));
        assertThrows(WorkflowException.class,()->edge().workerActor(gateway,"lab",UUID.randomUUID().toString()));
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->edge().workerActor(manager,"lab",execution));
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->edge().workerActor(gateway,"other",execution));
        edge().putTerminal(manager,"lab",terminal,new TerminalRegistration("a",false));
        assertEquals(worker,edge().workerActor(gateway,"lab",execution));
        drain();
    }
    @Test void heartbeatAndManagementUseAuthenticatedGatewayNotPayload() throws Exception {
        String terminal=terminal();
        assertEquals(401,call(null,"POST","/edge-access/heartbeat",null,null).statusCode());
        assertEquals(403,call("manager","POST","/edge-access/heartbeat",null,null).statusCode());
        assertEquals(403,call("gateway-a","GET","/edge/gateways",null,null).statusCode());
        assertEquals(403,call("gateway-a","GET","/flows",null,null).statusCode());
        assertEquals(403,call("gateway-b","POST","/edge-access/terminals/"+terminal+"/heartbeat",null,null).statusCode());
        assertNotNull(json.map(call("gateway-a","POST","/edge-access/heartbeat",null,null).body()).get("lastSeenAt"));
        assertNotNull(json.map(call("gateway-a","POST","/edge-access/terminals/"+terminal+"/heartbeat",null,null).body()).get("lastSeenAt"));
        assertEquals(403,call("gateway-a","POST","/executions","key",request("unknown")).statusCode());
    }
    @Test void terminalSubmitsMultiTaskFlowAndReceivesActualOutputs() throws Exception {
        String terminal=terminal(),flow=id();flows().save(manager,"lab",flow,0,source(flow));
        var execution=accepted(call("gateway-a","POST","/edge-access/terminals/"+terminal+"/executions","first",request(flow)));
        drain();
        var response=call("gateway-a","GET","/edge-access/terminals/"+terminal+"/executions/"+execution,null,null);
        assertEquals(200,response.statusCode());var result=json.map(response.body());
        assertEquals("SUCCESS",result.get("state"));assertEquals(Map.of("result","processed sample"),result.get("outputs"));
        assertEquals(2,executions().tasks(manager,"lab",execution).size());
        assertEquals("gateway-a",result.get("submittedBy"));
        assertEquals(execution,accepted(call("gateway-a","POST","/edge-access/terminals/"+terminal+"/executions","first",request(flow))));
    }
    @Test void eventMatchesPolicyAndManagementScopeCannotBeBypassed() throws Exception {
        String terminal=terminal(),policy=savePolicy();
        assertTrue(flows().list(manager,"lab",100,0).stream().noneMatch(f->f.flowId().equals(policy)));
        assertEquals(409,call("manager","GET","/flows/"+policy,null,null).statusCode());
        assertThrows(WorkflowException.class,()->flows().save(manager,"lab",policy,1,source(policy)));
        assertThrows(WorkflowException.class,()->flows().history(manager,"lab",policy,20,0));
        assertThrows(WorkflowException.class,()->executions().submit(manager,"lab",id(),request(policy)));
        assertEquals(200,call("manager","GET","/edge/policies/"+policy,null,null).statusCode());
        String execution=accepted(call("gateway-a","POST","/edge-access/terminals/"+terminal+"/events","event",new Event(policy,Map.of("value","sensor"))));
        drain();assertEquals(Map.of("result","processed sensor"),edge().result(gateway,"lab",terminal,execution).outputs());
    }
    @Test void policyEditAndDisableDoNotChangeAnAcceptedRequest() throws Exception {
        String terminal=terminal(),policy=savePolicy();Event event=new Event(policy,Map.of("value","original"));
        String execution=edge().event(gateway,"lab",terminal,"event",event);
        edge().putPolicy(manager,"lab",policy,new PolicyRequest("edge-a",policy,false,1,source(policy).replace("processed","changed")));
        assertEquals(execution,edge().event(gateway,"lab",terminal,"event",event));
        assertThrows(WorkflowException.class,()->edge().event(gateway,"lab",terminal,"new-event",event));
        drain();assertEquals(1,edge().result(gateway,"lab",terminal,execution).flowRevision());
        assertEquals(Map.of("result","processed original"),edge().result(gateway,"lab",terminal,execution).outputs());
    }
    @Test void concurrentDuplicateEventsCreateOneExecution() throws Exception {
        String terminal=terminal(),policy=savePolicy();Event event=new Event(policy,Map.of("value","same"));
        try(var pool=Executors.newFixedThreadPool(4)) {
            List<Future<String>> futures=new ArrayList<>();
            for(int i=0;i<4;i++) futures.add(pool.submit(()->edge().event(gateway,"lab",terminal,"concurrent",event)));
            Set<String> ids=new HashSet<>();for(var future:futures) ids.add(future.get(15,TimeUnit.SECONDS));assertEquals(1,ids.size());
        }
        assertEquals(1,jdbc().queryForObject("SELECT COUNT(*) FROM edge_submission WHERE terminal_id=?",Integer.class,terminal));
        assertEquals(1,executions().list(manager,"lab",100,0).stream().filter(e->e.flowId().equals(policy)).count());
        assertThrows(WorkflowException.class,()->edge().event(gateway,"lab",terminal,"concurrent",new Event(policy,Map.of("value","different"))));
        drain();
    }
    @Test void badInputAndMissingPolicyLeaveNoReceiptAndCanBeCorrected() throws Exception {
        String terminal=terminal(),policy=savePolicy();
        assertEquals(422,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/events","input",new Event(policy,Map.of())).statusCode());
        assertEquals(404,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/events","missing",new Event("missing",Map.of())).statusCode());
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM edge_submission WHERE terminal_id=?",Integer.class,terminal));
        edge().event(gateway,"lab",terminal,"input",new Event(policy,Map.of("value","correct")));drain();
    }
    @Test void checksRejectTerminalAndPolicyIngressWithoutLeavingReceipts() throws Exception {
        String terminal=terminal(),flow=id(),policy=id();
        String gate="checks: [{when: '{{ inputs.value == \"allowed\" }}', message: blocked}]\n";
        flows().save(manager,"lab",flow,0,source(flow)+gate);
        edge().putPolicy(manager,"lab",policy,new PolicyRequest("edge-a",policy,true,0,source(policy)+gate));
        int before=jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution",Integer.class);
        assertEquals(422,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/executions","gate",request(flow)).statusCode());
        assertEquals(422,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/events","gate",new Event(policy,Map.of("value","blocked"))).statusCode());
        assertEquals(before,jdbc().queryForObject("SELECT COUNT(*) FROM wf_execution",Integer.class));
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM edge_submission WHERE terminal_id=?",Integer.class,terminal));
        String accepted=edge().submit(gateway,"lab",terminal,"gate",new FlowExecutionService.Request(flow,null,Map.of("value","allowed")));
        drain();assertEquals(Map.of("result","processed allowed"),edge().result(gateway,"lab",terminal,accepted).outputs());
    }
    @Test void resultCannotBeReadByOtherTerminalOrGateway() throws Exception {
        String terminal=terminal(),other=terminal(),flow=id();flows().save(manager,"lab",flow,0,source(flow));
        String execution=edge().submit(gateway,"lab",terminal,"result",request(flow));
        assertEquals(403,call("gateway-b","GET","/edge-access/terminals/"+terminal+"/executions/"+execution,null,null).statusCode());
        assertEquals(404,call("gateway-a","GET","/edge-access/terminals/"+other+"/executions/"+execution,null,null).statusCode());
        executions().cancel(manager,"lab",execution);drain();
        assertEquals("KILLED",json.map(call("gateway-a","GET","/edge-access/terminals/"+terminal+"/executions/"+execution,null,null).body()).get("state"));
    }
    @Test void disabledTerminalAndGatewayStopAdmission() throws Exception {
        String terminal=terminal();
        edge().putTerminal(manager,"lab",terminal,new TerminalRegistration("a",false));
        assertEquals(403,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/heartbeat",null,null).statusCode());
        try {
            edge().putGateway(manager,"lab","a",new GatewayRegistration("edge-a","gateway-a",false));
            assertEquals(403,call("gateway-a","POST","/edge-access/heartbeat",null,null).statusCode());
        } finally { edge().putGateway(manager,"lab","a",new GatewayRegistration("edge-a","gateway-a",true)); }
    }
    @Test void gatewayAndTerminalOwnershipCannotBeReassigned() throws Exception {
        String terminal=terminal();
        assertEquals(409,call("manager","PUT","/edge/gateways/another",null,new GatewayRegistration("edge-a","gateway-a",true)).statusCode());
        assertEquals(409,call("manager","PUT","/edge/terminals/"+terminal,null,new TerminalRegistration("b",false)).statusCode());
        assertEquals(200,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/heartbeat",null,null).statusCode());
        assertEquals(422,call("manager","PUT","/edge/gateways/cloud",null,new GatewayRegistration("cloud","gateway-a",true)).statusCode());
        assertEquals(403,call("manager","PUT","/edge/gateways/manager",null,new GatewayRegistration("edge-a","manager",true)).statusCode());
    }
    @Test void policySaveIsAtomicAndEventRouteUnique() {
        String invalid=id();
        assertThrows(WorkflowException.class,()->edge().putPolicy(manager,"lab",invalid,new PolicyRequest("edge-a",invalid,true,0,"invalid source")));
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM edge_policy WHERE id=?",Integer.class,invalid));
        String policy=savePolicy(),other=id();
        assertThrows(WorkflowException.class,()->edge().putPolicy(manager,"lab",other,new PolicyRequest("edge-a",policy,true,0,source(other))));
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM wf_flow_head WHERE flow_id=?",Integer.class,other));
        assertThrows(WorkflowException.class,()->edge().putPolicy(manager,"lab",policy,policy(policy,0,false)));
        assertTrue(edge().policy(manager,"lab",policy).policy().enabled());
    }
    @Test void policyCannotEnableIndependentScheduleOrClaimUserFlow() {
        var writerOnly=new Actor("writer-only",Set.of("lab"),Set.of(Action.WRITE));
        String denied=id();
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,
                ()->edge().putPolicy(writerOnly,"lab",denied,policy(denied,0,true)));
        String flow=id();flows().save(manager,"lab",flow,0,source(flow));
        assertThrows(WorkflowException.class,()->edge().putPolicy(manager,"lab",flow,policy(flow,1,true)));
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM edge_policy WHERE id=?",Integer.class,flow));
        String scheduled=id();
        assertThrows(WorkflowException.class,()->edge().putPolicy(manager,"lab",scheduled,new PolicyRequest("edge-a",scheduled,true,0,
                source(scheduled)+"\nschedule: {cron: '0 * * * * *', timezone: UTC, disabled: false}\n")));
    }
    @Test void restartKeepsGatewayReceiptAndExecutionWithoutEdgeRecoveryState() throws Exception {
        String terminal=terminal(),policy=savePolicy();Event event=new Event(policy,Map.of("value","durable"));
        String execution=edge().event(gateway,"lab",terminal,"restart",event);
        context.close();context=open();
        assertEquals(execution,edge().event(gateway,"lab",terminal,"restart",event));drain();
        assertEquals(Map.of("result","processed durable"),edge().result(gateway,"lab",terminal,execution).outputs());
    }
    @Test void clusterAndNamespaceBoundariesAreEnforced() throws Exception {
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->edge().heartbeat(gateway,"other"));
        var resources=context.getBean(ResourceCatalogService.class);
        try {
            resources.putCluster(manager,"lab","edge-a",new Cluster("edge-a",Kind.EDGE,false));
            assertEquals(409,call("gateway-a","POST","/edge-access/heartbeat",null,null).statusCode());
        } finally { resources.putCluster(manager,"lab","edge-a",new Cluster("edge-a",Kind.EDGE,true)); }
        String terminal=id(),policy=savePolicy();
        edge().putTerminal(manager,"lab",terminal,new TerminalRegistration("b",true));
        assertEquals(404,call("gateway-b","POST","/edge-access/terminals/"+terminal+"/events","wrong-cluster",new Event(policy,Map.of("value","test"))).statusCode());
    }
    @Test void keyIsScopedToTerminalButNotToRequestKind() throws Exception {
        String first=terminal(),second=terminal(),flow=id();flows().save(manager,"lab",flow,0,source(flow));
        String a=edge().submit(gateway,"lab",first,"same-key",request(flow));
        String b=edge().submit(gateway,"lab",second,"same-key",request(flow));assertNotEquals(a,b);
        assertThrows(WorkflowException.class,()->edge().event(gateway,"lab",first,"same-key",new Event(flow,Map.of("value","test"))));
        drain();
    }
    @Test void newEventUsesNewRevisionButOldReceiptKeepsOriginalExecution() throws Exception {
        String terminal=terminal(),policy=savePolicy();Event event=new Event(policy,Map.of("value","sample"));
        String a=edge().event(gateway,"lab",terminal,"v1",event);
        edge().putPolicy(manager,"lab",policy,new PolicyRequest("edge-a",policy,true,1,source(policy).replace("processed","updated")));
        String b=edge().event(gateway,"lab",terminal,"v2",event);drain();
        assertEquals(Map.of("result","processed sample"),edge().result(gateway,"lab",terminal,a).outputs());
        assertEquals(Map.of("result","updated sample"),edge().result(gateway,"lab",terminal,b).outputs());
        assertEquals(2,edge().result(gateway,"lab",terminal,b).flowRevision());
        assertEquals(a,edge().event(gateway,"lab",terminal,"v1",event));
    }
    @Test void malformedRequestAndMissingIdempotencyHeaderDoNotSubmit() throws Exception {
        String terminal=terminal(),flow=id();flows().save(manager,"lab",flow,0,source(flow));
        assertEquals(400,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/executions",null,request(flow)).statusCode());
        assertEquals(400,call("gateway-a","POST","/edge-access/terminals/"+terminal+"/executions","invalid",Map.of("flowId",flow,"terminalId","spoof","inputs",Map.of("value","x"))).statusCode());
        assertEquals(0,jdbc().queryForObject("SELECT COUNT(*) FROM edge_submission WHERE terminal_id=?",Integer.class,terminal));
    }
}

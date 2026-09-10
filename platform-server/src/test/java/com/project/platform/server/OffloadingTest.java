package com.project.platform.server;

import com.project.platform.offloading.*;
import com.project.platform.offloading.OffloadingService.*;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.resource.placement.JobPlacementService;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.model.WorkflowException;
import java.util.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.MySQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OffloadingTest {
    private final MySQLContainer<?> mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("off_test").withUsername("test").withPassword("test-only");
    private ConfigurableApplicationContext context;
    private final Actor actor=new Actor("manager",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private final JsonCodec json=new JsonCodec();
    @BeforeAll void start() {
        mysql.start();
        try {
            context=new SpringApplicationBuilder(BackendApplication.class).run("--server.port=0","--logging.level.root=WARN",
                    "--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false",
                    "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),"--spring.datasource.password="+mysql.getPassword(),
                    "--platform.security.users[0].name=manager","--platform.security.users[0].password=test-only","--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE",
                    "--platform.security.users[1].name=gateway","--platform.security.users[1].password=test-only","--platform.security.users[1].namespaces=lab","--platform.security.users[1].actions=CONNECT");
            context.getBean(ResourceCatalogService.class).putCluster(actor,"lab","edge",new Cluster("edge",Kind.EDGE,true));
        } catch(RuntimeException ex){stop();throw ex;}
    }
    @AfterAll void stop(){if(context!=null)context.close();mysql.stop();}
    private OffloadingService service(){return context.getBean(OffloadingService.class);}
    private JobPlacementService slots(){return context.getBean(JobPlacementService.class);}
    private String key(){return UUID.randomUUID().toString();}
    private Workload work(){return new Workload("app","v1",List.of("sh","-c","echo hello"),Map.of("SIZE",1),1024);}
    static DqnModel model(double... q){return new DqnModel(DqnModel.SCHEMA,new double[2][13],new double[2],new double[3][2],q);}
    private List<Candidate> options(int busy){return List.of(new Candidate(new Target("TERMINAL","pc"),1,busy,0),new Candidate(new Target("EDGE","edge"),2,0,0));}
    @Test void dqnUsesWeightsAndMasksUnavailableActions() {
        double[] state=new double[13];state[1]=1;state[5]=1;
        assertEquals(1,model(0,3,100).choose(state));state[5]=0;assertEquals(0,model(0,3,100).choose(state));
        state[1]=0;assertThrows(WorkflowException.class,()->model(0,3,100).choose(state));
        var network=new DqnModel(DqnModel.SCHEMA,new double[][]{{2,0,0,0,0,0,0,0,0,0,0,0,0}},new double[]{-1},new double[][]{{1},{2},{3}},new double[]{1,1,1});
        state[0]=1;assertArrayEquals(new double[]{2,3,4},network.predict(state),1e-12);
    }
    @Test void rejectsMalformedNonFiniteAndUnknownSchemaModels() {
        assertThrows(WorkflowException.class,()->model(1,2,Double.NaN).validate());
        assertThrows(WorkflowException.class,()->new DqnModel("old",new double[1][13],new double[1],new double[3][1],new double[3]).validate());
        assertThrows(WorkflowException.class,()->new DqnModel(DqnModel.SCHEMA,new double[1][12],new double[1],new double[3][1],new double[3]).validate());
    }
    @Test void modelsAreImmutableAndNamespaceAuthorized() {
        String version=key();service().register(actor,"lab",version,model(1,2,3));
        assertEquals(3,service().model(actor,"lab",version).bias2()[2]);
        service().register(actor,"lab",version,model(1,2,3));
        assertThrows(WorkflowException.class,()->service().register(actor,"lab",version,model(3,2,1)));
        assertThrows(Forbidden.class,()->service().model(actor,"other",version));
        assertThrows(WorkflowException.class,()->service().model(actor,"lab","missing"));
    }
    @Test void rulesUseRealLoadAndPersistOneChoicePerAttempt() {
        String key=key();var selected=service().decide(actor,"lab",key,key,work(),options(1),"RULE",null);
        assertEquals("EDGE",selected.target().kind());assertEquals(1,selected.action());
        var again=service().decide(actor,"lab",key,key,work(),options(0),"RULE",null);
        assertEquals(selected.target(),again.target());assertEquals(selected.createdAt(),again.createdAt());
        assertEquals(0,selected.state()[9]);assertEquals(0,selected.state()[4]);
    }
    @Test void dqnRequiresRealRegisteredVersionAndPreservesIt() {
        String version=key(),key=key();
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key,key,work(),options(0),"DQN",version));
        assertNull(service().get("lab",key));service().register(actor,"lab",version,model(0,3,100));
        var selected=service().decide(actor,"lab",key,key,work(),options(0),"DQN",version);
        assertEquals(version,selected.modelVersion());assertEquals(1,selected.action());
    }
    @Test void profilesUseVersionCommandParametersSizeAndLocationAndFeedbackIsIdempotent() {
        String key=key();var w=new Workload(key,"v1",work().command(),work().parameters(),1024);var target=new Target("EDGE","edge");
        service().decide(actor,"lab",key,key,new Workload(w.applicationId(),w.version(),w.command(),w.parameters(),777),List.of(new Candidate(target,1,0,0)),"RULE",null);
        service().started(actor,"lab",key,w.inputBytes());
        var started=service().get("lab",key);service().started(actor,"lab",key,9999);
        assertEquals(w.inputBytes(),service().get("lab",key).inputBytes());assertEquals(started.startedAt(),service().get("lab",key).startedAt());
        service().finish("lab",key,"SUCCESS");var finished=service().get("lab",key);service().finish("lab",key,"FAILED");
        assertEquals(finished.finishedAt(),service().get("lab",key).finishedAt());assertEquals("SUCCESS",service().get("lab",key).outcome());
        assertNotNull(service().estimate(actor,"lab",w,target));
        assertNull(service().estimate(actor,"lab",new Workload(key,"v2",w.command(),w.parameters(),1024),target));
        assertNull(service().estimate(actor,"lab",new Workload(key,"v1",List.of("other"),w.parameters(),1024),target));
        assertNull(service().estimate(actor,"lab",new Workload(key,"v1",w.command(),Map.of("SIZE",2),1024),target));
        assertNull(service().estimate(actor,"lab",new Workload(key,"v1",w.command(),w.parameters(),1<<20),target));
        assertNull(service().estimate(actor,"lab",w,new Target("TERMINAL","pc")));
    }
    @Test void cancelledAndUnstartedSamplesDoNotTrainOrContaminateProfiles() {
        for(String outcome:List.of("CANCELLED","FAILED")) {
            String key=key();var w=new Workload(key,"v1",work().command(),Map.of(),1);var target=new Target("EDGE","edge");
            service().decide(actor,"lab",key,key,w,List.of(new Candidate(target,1,0,0)),"RULE",null);if(outcome.equals("CANCELLED"))service().started(actor,"lab",key,w.inputBytes());
            service().finish("lab",key,outcome);assertNull(service().get("lab",key).reward());assertNull(service().estimate(actor,"lab",w,target));
        }
    }
    @Test void terminalSlotsAreDurableFifoAndWaitingCancellationCannotResurrect() {
        String terminal=key(),a=key(),b=key(),c=key();
        assertTrue(slots().reserveTerminal(actor,"lab",a,"edge",terminal,1));
        assertFalse(slots().reserveTerminal(actor,"lab",b,"edge",terminal,1));assertFalse(slots().reserveTerminal(actor,"lab",c,"edge",terminal,1));
        slots().releaseTerminal("lab",a,"edge",terminal);assertFalse(slots().reserveTerminal(actor,"lab",c,"edge",terminal,1));
        assertTrue(slots().reserveTerminal(actor,"lab",b,"edge",terminal,1));
        assertTrue(slots().releaseTerminal("lab",c));assertTrue(slots().releaseTerminal("lab",b));
        assertFalse(slots().releaseTerminal("other",b));assertFalse(slots().releaseTerminal("lab",key()));
        assertFalse(slots().reserveTerminal(actor,"lab",c,"edge",terminal,1));
        assertEquals(0,slots().terminalLoad(actor,"lab","edge",terminal,1).active());
        assertEquals(0,slots().terminalLoad(actor,"lab","edge",terminal,1).waiting());
    }
    @Test void concurrentTerminalClaimsCannotExceedCapacity() throws Exception {
        String terminal=key();
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var attempts=new ArrayList<Future<Boolean>>();for(int i=0;i<8;i++)attempts.add(pool.submit(()->slots().reserveTerminal(actor,"lab",key(),"edge",terminal,2)));
            int admitted=0;for(var future:attempts)if(future.get())admitted++;assertEquals(2,admitted);
            assertEquals(2,slots().terminalLoad(actor,"lab","edge",terminal,2).active());
        }
    }
    @Test void modelAndSampleHttpEndpointsEnforcePermissions() throws Exception {
        String version=key();assertEquals(200,call("manager","PUT","/models/"+version,model(1,2,3)).statusCode());
        assertEquals(200,call("manager","GET","/models/"+version,null).statusCode());
        assertEquals(200,call("manager","GET","/samples?limit=10",null).statusCode());
        assertEquals(403,call("gateway","GET","/samples",null).statusCode());
        assertEquals(403,call("gateway","PUT","/models/"+key(),model(1,2,3)).statusCode());
        assertEquals(409,call("manager","PUT","/models/"+version,model(3,2,1)).statusCode());
    }
    private HttpResponse<String> call(String user,String method,String path,Object value) throws Exception {
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab/offloading"+path))
                .header("Authorization","Basic "+Base64.getEncoder().encodeToString((user+":test-only").getBytes(StandardCharsets.UTF_8))).header("Content-Type","application/json")
                .method(method,value==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.write(value))).build();
        return HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.ofString());
    }
}

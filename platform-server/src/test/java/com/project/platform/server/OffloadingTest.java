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
                    "--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false","--platform.jobs.central-clouds.lab=cloud-b,cloud-a",
                    "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),"--spring.datasource.password="+mysql.getPassword(),
                    "--platform.security.users[0].name=manager","--platform.security.users[0].password=test-only","--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE",
                    "--platform.security.users[1].name=gateway","--platform.security.users[1].password=test-only","--platform.security.users[1].namespaces=lab","--platform.security.users[1].actions=CONNECT");
            context.getBean(ResourceCatalogService.class).putCluster(actor,"lab","edge",new Cluster("edge",Kind.EDGE,true));
            for(String id:List.of("cloud-a","cloud-b","unconfigured-cloud"))context.getBean(ResourceCatalogService.class).putCluster(actor,"lab",id,new Cluster(id,Kind.CLOUD,true));
            context.getBean(ResourceCatalogService.class).putCluster(actor,"lab","other-edge",new Cluster("other-edge",Kind.EDGE,true));
        } catch(RuntimeException ex){stop();throw ex;}
    }
    @AfterAll void stop(){if(context!=null)context.close();mysql.stop();}
    private OffloadingService service(){return context.getBean(OffloadingService.class);}
    private JobPlacementService slots(){return context.getBean(JobPlacementService.class);}
    private String key(){return UUID.randomUUID().toString();}
    private Workload work(){return new Workload("app","v1",List.of("sh","-c","echo hello"),Map.of("SIZE",1),1024);}
    static DqnModel model(double... q){return new DqnModel(DqnModel.SCHEMA,new double[2][6],new double[2],new double[3][2],q);}
    private List<Candidate> options(int busy){return List.of(new Candidate(Layer.TERMINAL,1,busy,0),new Candidate(Layer.EDGE,2,0,0));}
    private com.project.platform.resource.placement.WorkloadLedger ledger(){return context.getBean(com.project.platform.resource.placement.WorkloadLedger.class);}
    private Sample measured(String key,String terminal,String flow,long bytes,Layer layer,Double transfer) {
        return ledger().accept(actor,"lab",key,terminal,"edge","cloud-a",flow,bytes,load->{
            service().decide(actor,"lab",key,key,work(),List.of(new Candidate(layer,1,0,0)),"FIXED",null,layer);
            var sample=service().capture("lab",key,"edge",terminal,flow,new Double[]{bytes/1048576.0,load.terminalBytes()/1048576.0,
                    load.edgeBytes()/1048576.0,load.cloudBytes()/1048576.0,transfer,transfer},List.of(layer.ordinal()),
                    !load.comparable()?"mixed or unmeasured active workload":transfer==null?"transfer calibration incomplete":null);
            return new com.project.platform.resource.placement.WorkloadLedger.Choice<>(layer.name(),sample);
        });
    }
    @Test void nextStateIsNextDecisionNotOutOfOrderCompletionAndFeedbackIsImmutable() {
        String a=key(),b=key(),c=key(),terminal=key(),flow=key();
        try {
            measured(a,terminal,flow,2097152,Layer.TERMINAL,2.0);
            var second=measured(b,terminal,flow,1048576,Layer.EDGE,1.0);
            assertEquals(2.0,second.measurement().inputs()[1]);
            assertEquals(b,service().get("lab",a).measurement().nextKey());
            service().finish("lab",b,"SUCCESS");ledger().release("lab",b);
            service().feedback("lab",b,terminal,new Feedback("SUCCESS",12.0));
            assertFalse(service().get("lab",b).measurement().trainable(),"tail lacks next decision");
            measured(c,terminal,flow,524288,Layer.CLOUD,0.5);
            assertTrue(service().get("lab",b).measurement().trainable());
            service().finish("lab",a,"SUCCESS");ledger().release("lab",a);
            service().feedback("lab",a,terminal,new Feedback("SUCCESS",60.0));
            var first=service().get("lab",a);
            assertTrue(first.measurement().trainable());assertEquals(-0.5,first.reward());
            assertArrayEquals(second.state(),first.measurement().nextState());assertEquals(b,first.measurement().nextKey());
            assertEquals(Math.log1p(2.0),first.measurement().nextState()[1]);
            service().feedback("lab",a,terminal,new Feedback("SUCCESS",60.0));
            assertThrows(WorkflowException.class,()->service().feedback("lab",a,terminal,new Feedback("SUCCESS",61.0)));
            assertThrows(WorkflowException.class,()->service().feedback("lab",a,"other",new Feedback("SUCCESS",60.0)));
        } finally {for(String k:List.of(a,b,c))ledger().release("lab",k);}
    }
    @Test void calibrationMissingFeedbackAndCancelledSamplesAreNotTrainable() {
        String a=key(),b=key(),c=key(),terminal=key(),flow=key();
        try {
            assertNull(measured(a,terminal,flow,1024,Layer.TERMINAL,null).state());
            measured(b,terminal,flow,1024,Layer.TERMINAL,1.0);measured(c,terminal,flow,1024,Layer.TERMINAL,1.0);
            service().finish("lab",a,"SUCCESS");service().feedback("lab",a,terminal,new Feedback("SUCCESS",1.0));
            assertFalse(service().get("lab",a).measurement().trainable());
            service().finish("lab",b,"SUCCESS");assertNull(service().get("lab",b).reward());
            service().feedback("lab",b,terminal,new Feedback("UNMEASURED",null));
            assertFalse(service().get("lab",b).measurement().trainable());
            service().finish("lab",c,"CANCELLED");service().feedback("lab",c,terminal,new Feedback("CANCELLED",2.0));
            assertNull(service().get("lab",c).reward());
        } finally {for(String k:List.of(a,b,c))ledger().release("lab",k);}
    }
    @Test void workloadTakeoverDoesNotDoubleCountAndReleaseCannotResurrect() {
        String a=key(),b=key(),terminal=key(),flow=key();
        try {
            var first=measured(a,terminal,flow,2048,Layer.EDGE,1.0);
            var takeover=measured(a,terminal,flow,2048,Layer.EDGE,3.0);
            assertArrayEquals(first.state(),takeover.state(),"decision snapshot is frozen");
            assertEquals(2048/1048576.0,measured(b,terminal,flow,1024,Layer.CLOUD,1.0).measurement().inputs()[2]);
            ledger().release("lab",a);ledger().release("lab",a);
            assertThrows(ResourceException.class,()->measured(a,terminal,flow,2048,Layer.EDGE,1.0));
        } finally {ledger().release("lab",a);ledger().release("lab",b);}
    }
    @Test void concurrentAdmissionCountsEveryUnfinishedWorkloadOnce() throws Exception {
        String terminal=key(),flow=key();var keys=new ArrayList<String>();for(int i=0;i<8;i++)keys.add(key());
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var pending=new ArrayList<Future<Sample>>();for(String k:keys)pending.add(pool.submit(()->measured(k,terminal,flow,1048576,Layer.TERMINAL,1.0)));
            var loads=new TreeSet<Double>();for(var p:pending)loads.add(p.get().measurement().inputs()[1]);
            assertEquals(new TreeSet<>(List.of(0.0,1.0,2.0,3.0,4.0,5.0,6.0,7.0)),loads);
        } finally {keys.forEach(k->ledger().release("lab",k));}
    }
    @Test void unknownOrDifferentActiveWorkloadDoesNotBecomeZeroQueue() {
        String a=key(),b=key(),terminal=key();
        try {
            measured(a,terminal,key(),1024,Layer.EDGE,1.0);
            var mixed=measured(b,terminal,key(),1024,Layer.CLOUD,1.0);
            assertNull(mixed.state());assertTrue(mixed.measurement().unavailable().contains("mixed"));
            ledger().release("lab",a);ledger().release("lab",b);
            String untracked=key(),next=key();
            try {
                slots().reserveTerminal(actor,"lab",untracked,"edge",terminal,1);
                assertNull(measured(next,terminal,key(),1024,Layer.TERMINAL,1.0).state());
            } finally {slots().releaseTerminal("lab",untracked);ledger().release("lab",next);}
        } finally {ledger().release("lab",a);ledger().release("lab",b);}
    }
    @Test void transferRatesUseLastTwentyCompleteUniqueTransfersAndMeasuredSeconds() {
        var transfers=context.getBean(com.project.platform.resource.storage.TransferMeasurements.class);
        String source=key(),target=key(),first=key();
        assertNull(transfers.seconds("lab",source,target,100));
        transfers.record("lab",first,"UPLOAD","data",source,target,1000,1);
        transfers.record("lab",first,"UPLOAD","data",source,target,9999,0.1);
        assertEquals(1000,transfers.rate("lab",source,target).bytesPerSecond());
        for(int i=0;i<20;i++)transfers.record("lab",key(),"UPLOAD","data",source,target,200,2);
        assertEquals(20,transfers.rate("lab",source,target).transfers());assertEquals(5,transfers.seconds("lab",source,target,500));
        for(double invalid:new double[]{0,-1,Double.NaN,Double.POSITIVE_INFINITY})assertThrows(ResourceException.class,()->transfers.record("lab",key(),"UPLOAD","data",source,target,100,invalid));
    }
    @Test void feedbackValidatesClockAndDeadlineBeforeWriting() {
        for(Feedback invalid:Arrays.asList(null,new Feedback(null,1.0),new Feedback("SUCCESS",Double.NaN),new Feedback("SUCCESS",0.0),new Feedback("UNMEASURED",1.0),new Feedback("TIMEOUT",1.0)))
            assertThrows(WorkflowException.class,()->service().feedback("lab",key(),key(),invalid));
        String a=key(),terminal=key();
        try {
            measured(a,terminal,key(),1024,Layer.TERMINAL,1.0);
            service().feedback("lab",a,terminal,new Feedback("SUCCESS",121.0));
            assertEquals("TIMEOUT",service().get("lab",a).measurement().feedbackOutcome());assertEquals(-2.0,service().get("lab",a).reward());
            assertFalse(service().get("lab",a).measurement().trainable(),"feedback does not mean remote completion");
        } finally {ledger().release("lab",a);}
    }
    @Test void waitingAndRunningReservationsBothRemainInQueueUntilConfirmedRelease() {
        String a=key(),b=key(),c=key(),terminal=key(),flow=key();
        try {
            measured(a,terminal,flow,1048576,Layer.TERMINAL,1.0);
            assertTrue(slots().reserveTerminal(actor,"lab",a,"edge",terminal,1));
            measured(b,terminal,flow,2097152,Layer.TERMINAL,1.0);
            assertFalse(slots().reserveTerminal(actor,"lab",b,"edge",terminal,1));
            assertEquals(1,slots().terminalLoad(actor,"lab","edge",terminal,1).waiting());
            var third=measured(c,terminal,flow,1024,Layer.TERMINAL,1.0);
            assertEquals(3.0,third.measurement().inputs()[1],"includes the running 1MiB and waiting 2MiB");
            slots().releaseTerminal("lab",a);ledger().release("lab",a);
            assertTrue(slots().reserveTerminal(actor,"lab",b,"edge",terminal,1));
        } finally {for(String k:List.of(a,b,c)){slots().releaseTerminal("lab",k);ledger().release("lab",k);}}
    }
    @Test void inputReportsUseVerifiedSingleFileBytesAndDoNotRequireAnotherStorageCall() throws Exception {
        String a=key(),terminal=key(),source=key();
        try {
            measured(a,terminal,key(),1024,Layer.EDGE,1.0);
            var adapter=context.getBean(com.project.platform.dataflow.execution.OffloadingTaskAdapter.class);
            var rates=context.getBean(com.project.platform.resource.storage.TransferMeasurements.class);
            var inputs=Map.of("data","s3://"+source+"/lab/file");
            adapter.downloaded("lab",a,"edge",inputs,"not-json");
            adapter.downloaded("lab",a,"edge",inputs,"{\"transfers\":[{\"name\":\"data\",\"bytes\":2,\"seconds\":1}]}");
            assertNull(rates.rate("lab","store:"+source,"cluster:edge"));
            adapter.downloaded("lab",a,"edge",inputs,"{\"transfers\":[{\"name\":\"data\",\"bytes\":1024,\"seconds\":2}]}");
            assertEquals(512,rates.rate("lab","store:"+source,"cluster:edge").bytesPerSecond());
        } finally {ledger().release("lab",a);}
    }
    @Test void edgeDecisionRecordsOnlyLegalLayerAndPinnedModelBeforePlacement() {
        model(0,3,100).validate();String key=key(),version=key();
        assertThrows(WorkflowException.class,()->service().edgeDecision(actor,"lab",key,key,work(),version,List.of(0,1),2));
        assertNull(service().get("lab",key));
        var selected=service().edgeDecision(actor,"lab",key,key,work(),version,List.of(0,1),1);
        assertEquals("EDGE",selected.target().kind());assertNull(selected.target().id());assertEquals("DQN",selected.strategy());assertEquals(version,selected.modelVersion());
        assertEquals(1,service().edgeDecision(actor,"lab",key,key,work(),version,List.of(0,1),0).action());
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
    @Test void historicalThirteenStateModelIsReadableButCannotBeRegisteredOrExecutedAsSixState() {
        String version=key();var legacy=new DqnModel("terminal-slot-cost-v1",new double[1][13],new double[1],new double[3][1],new double[3]);
        context.getBean(JdbcTemplate.class).update("INSERT INTO off_dqn_model(namespace,version,model_json) VALUES(?,?,?)","lab",version,json.write(legacy));
        var read=service().model(actor,"lab",version);assertEquals("terminal-slot-cost-v1",read.stateSchema());
        assertThrows(WorkflowException.class,read::validate);
        assertThrows(WorkflowException.class,()->service().register(actor,"lab",key(),legacy));
    }
    @Test void normalizedSixStateNeverFillsMissingOrMixedInputsForInference() {
        assertNull(OffloadingService.normalize(new Double[]{1.0,0.0,0.0,0.0,null,1.0},null));
        assertNull(OffloadingService.normalize(new Double[]{1.0,0.0,0.0,0.0,1.0,1.0},"mixed"));
        assertThrows(WorkflowException.class,()->OffloadingService.normalize(new Double[]{1.0,0.0,0.0,0.0,-1.0,1.0},null));
    }
    @Test void rulesUseRealLoadAndPersistOneChoicePerAttempt() {
        String key=key();var selected=service().decide(actor,"lab",key,key,work(),options(1),"RULE",null);
        assertEquals("EDGE",selected.target().kind());assertEquals(1,selected.action());
        var again=service().decide(actor,"lab",key,key,work(),options(0),"RULE",null);
        assertEquals(selected.target(),again.target());assertEquals(selected.createdAt(),again.createdAt());
        assertNull(selected.target().id());assertNull(selected.state(),"do not reinterpret legacy 13-dimensional state");
    }
    @Test void oldDqnCannotBeRunWithNewLayerSemanticsEvenWhenRegistered() {
        String version=key(),key=key();
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key,key,work(),options(0),"DQN",version));
        assertNull(service().get("lab",key));service().register(actor,"lab",version,model(0,3,100));
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key,key,work(),options(0),"DQN",version));
        assertNull(service().get("lab",key));
    }
    @Test void actualPositionIsRecordedAfterPlacementAndCannotChangeLayerOrLocation() {
        String key=key();var w=new Workload(key,"v1",work().command(),work().parameters(),1024);var target=new Target("EDGE","edge");
        service().decide(actor,"lab",key,key,new Workload(w.applicationId(),w.version(),w.command(),w.parameters(),777),List.of(new Candidate(Layer.EDGE,1,0,0)),"RULE",null);
        assertNull(service().get("lab",key).target().id());
        assertThrows(WorkflowException.class,()->service().placed(actor,"lab",key,new Target("CLOUD","cloud-a")));
        service().placed(actor,"lab",key,target);service().placed(actor,"lab",key,target);
        assertEquals(target,service().get("lab",key).target());
        assertThrows(WorkflowException.class,()->service().placed(actor,"lab",key,new Target("EDGE","other-edge")));
        service().started(actor,"lab",key,w.inputBytes());
        var started=service().get("lab",key);service().started(actor,"lab",key,9999);
        assertEquals(w.inputBytes(),service().get("lab",key).inputBytes());assertEquals(started.startedAt(),service().get("lab",key).startedAt());
        service().finish("lab",key,"SUCCESS");var finished=service().get("lab",key);service().finish("lab",key,"FAILED");
        assertEquals(finished.finishedAt(),service().get("lab",key).finishedAt());assertEquals("SUCCESS",service().get("lab",key).outcome());
        assertNotNull(finished.reward());
    }
    @Test void cancelledAndUnstartedSamplesHaveNoReward() {
        for(String outcome:List.of("CANCELLED","FAILED")) {
            String key=key();var w=new Workload(key,"v1",work().command(),Map.of(),1);var target=new Target("EDGE","edge");
            service().decide(actor,"lab",key,key,w,List.of(new Candidate(Layer.EDGE,1,0,0)),"RULE",null);if(outcome.equals("CANCELLED"))service().started(actor,"lab",key,w.inputBytes());
            service().finish("lab",key,outcome);assertNull(service().get("lab",key).reward());
        }
    }
    @Test void scopeComesFromOwnerEdgeAndConfiguredCloudsNotOtherRegisteredClusters() {
        assertEquals(List.of("edge"),slots().layerScope(actor,"lab",Kind.EDGE,"edge"));
        assertEquals(List.of("cloud-b","cloud-a"),slots().layerScope(actor,"lab",Kind.CLOUD,"edge"));
        assertThrows(ResourceException.class,()->slots().layerScope(actor,"lab",Kind.EDGE,"cloud-a"));
        assertThrows(Forbidden.class,()->slots().layerScope(actor,"other",Kind.CLOUD,"edge"));
    }
    @Test void ruleReceivesOneAggregatePerLayerAndUsesDeterministicTies() {
        assertEquals("TERMINAL",service().decide(actor,"lab",key(),key(),work(),options(0),"RULE",null).target().kind());
        assertEquals("CLOUD",service().decide(actor,"lab",key(),key(),work(),List.of(new Candidate(Layer.EDGE,1,1,0),new Candidate(Layer.CLOUD,4,1,0)),"RULE",null).target().kind());
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key(),key(),work(),List.of(),"RULE",null));
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key(),key(),work(),List.of(new Candidate(Layer.EDGE,1,0,0),new Candidate(Layer.EDGE,1,0,0)),"RULE",null));
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key(),key(),work(),List.of(new Candidate(Layer.EDGE,0,0,0)),"RULE",null));
    }
    @Test void fixedSelectsOnlyAnExplicitLegalLayerWithoutClusterSelectionOrFallback() {
        assertEquals("CLOUD",service().decide(actor,"lab",key(),key(),work(),List.of(new Candidate(Layer.CLOUD,1,0,0)),"FIXED",null,Layer.CLOUD).target().kind());
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key(),key(),work(),List.of(new Candidate(Layer.EDGE,1,0,0)),"FIXED",null,Layer.CLOUD));
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key(),key(),work(),options(0),"FIXED",null,null));
        assertThrows(WorkflowException.class,()->service().decide(actor,"lab",key(),key(),work(),options(0),"RULE",null,Layer.CLOUD));
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

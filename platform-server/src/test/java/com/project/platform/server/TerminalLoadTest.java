package com.project.platform.server;

import com.project.platform.edge.*;
import com.project.platform.edge.TerminalLoad.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.runtime.model.WorkflowException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.MySQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TerminalLoadTest {
    private final MySQLContainer<?> mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("terminal_load_test").withUsername("load_test").withPassword("test-only");
    private ConfigurableApplicationContext context;
    private TerminalLoadService loads;
    private EdgeAccessService edge;
    private final Actor manager=new Actor("manager",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private final Actor gateway=new Actor("gateway",Set.of("lab"),Set.of(Action.CONNECT));
    @BeforeAll void setup() {
        mysql.start();
        context=new SpringApplicationBuilder(BackendApplication.class).run("--server.port=0","--logging.level.root=WARN",
            "--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false",
            "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),"--spring.datasource.password="+mysql.getPassword(),
            "--platform.security.users[0].name=manager","--platform.security.users[0].password=test-only","--platform.security.users[0].namespaces=lab","--platform.security.users[0].actions=READ,WRITE,EXECUTE",
            "--platform.security.users[1].name=gateway","--platform.security.users[1].password=test-only","--platform.security.users[1].namespaces=lab","--platform.security.users[1].actions=CONNECT");
        context.getBean(ResourceCatalogService.class).putCluster(manager,"lab","edge-a",new Cluster("edge-a",Kind.EDGE,true));
        edge=context.getBean(EdgeAccessService.class);
        edge.putGateway(manager,"lab","gateway",new EdgeAccess.GatewayRegistration("edge-a","gateway",true));
        for(String strategy:List.of("local","dqn"))edge.putPolicy(manager,"lab",strategy,new EdgeAccess.PolicyRequest("edge-a",strategy,true,0,source(strategy)));
        loads=new TerminalLoadService(context.getBean(JdbcTerminalLoadRepository.class),edge,context.getBean(AccessPolicy.class),context.getBean(TransactionTemplate.class),
            Map.of("lab",Map.of("signal",new Profile("振动分析",Map.of("edge-a",new PolicyPair("local","dqn"))))));
    }
    @AfterAll void close(){if(context!=null)context.close();mysql.stop();}
    private String source(String strategy) {
        return """
            schemaVersion: 1
            namespace: lab
            id: %s
            inputs:
              data_file: {type: OBJECT, required: true}
            tasks:
              - id: features
                type: platform.Application
                timeout: PT2M
                container:
                  applicationId: signal
                  version: v1
                  execution: TERMINAL
                  offload: %s
                  command: [python, /app/app.py]
                  inputFiles:
                    signal.csv: {source: INPUT, name: data_file}
                  outputFiles: [result.json]
            outputs:
              terminal_result: {source: TASK_OUTPUT, taskId: features, port: result.json}
            """.formatted(strategy,strategy.equals("local")?"{strategy: FIXED, layer: TERMINAL}":"{strategy: DQN, modelVersion: frozen-v1, exploration: 0}");
    }
    private String terminal() {
        String id="t"+UUID.randomUUID().toString().replace("-","");
        edge.putTerminal(manager,"lab",id,new EdgeAccess.TerminalRegistration("gateway",true));
        loads.resource(gateway,"lab",id,resource(null,false,0));return id;
    }
    private Resource resource(String run,boolean sending,int pending){return new Resource(.1,1,67108864,.5,536870912,run,sending,pending);}
    private Run start(String t){return loads.start(manager,"lab",new Start("signal",List.of(t),5,31,"mixed","LOCAL"));}
    private Compute compute(String run){return new Compute(run,UUID.randomUUID().toString(),Map.of("fileId",UUID.randomUUID().toString(),"bytes",100));}
    @Test void switchingPinsEachRequestAndReusesExecutionOnRetry() {
        String t=terminal();var run=start(t);var first=compute(run.id());
        String execution=loads.compute(gateway,"lab",t,first);
        loads.switchStrategy(manager,"lab",run.id(),"DQN");
        assertEquals(execution,loads.compute(gateway,"lab",t,first));
        assertThrows(WorkflowException.class,()->loads.compute(gateway,"lab",t,new Compute(run.id(),first.requestId(),Map.of("fileId",UUID.randomUUID().toString(),"bytes",100))));
        loads.compute(gateway,"lab",t,compute(run.id()));
        var snapshot=loads.snapshot(manager,"lab",run.id(),null,null);
        assertEquals(List.of(1,2),snapshot.requests().stream().map(Request::phase).toList());
        assertEquals(2,snapshot.phases().size());
        assertEquals(1,edge.result(gateway,"lab",t,execution).flowRevision());
    }
    @Test void stopDrainsBeforeAllowingAnotherRun() {
        String t=terminal();var run=start(t);
        assertThrows(WorkflowException.class,()->start(t));
        loads.stop(manager,"lab",run.id());
        assertFalse(loads.resource(gateway,"lab",t,resource(run.id(),false,1)).sending());
        assertThrows(WorkflowException.class,()->loads.compute(gateway,"lab",t,compute(run.id())));
        assertNull(loads.resource(gateway,"lab",t,resource(run.id(),false,0)));
        assertNotEquals(run.id(),start(t).id());
    }
    @Test void resultAndOwnershipAreCheckedAndMeasurementsSurviveStop() {
        String t=terminal(),other=terminal();var run=start(t);var request=compute(run.id());
        loads.compute(gateway,"lab",t,request);
        assertThrows(AccessPolicy.Forbidden.class,()->loads.compute(gateway,"lab",other,compute(run.id())));
        assertThrows(WorkflowException.class,()->loads.report(gateway,"lab",t,new Report(run.id(),request.requestId(),2,"SUCCESS",null)));
        loads.report(gateway,"lab",t,new Report(run.id(),request.requestId(),240,"TIMEOUT",null));
        loads.report(gateway,"lab",t,new Report(run.id(),request.requestId(),999,"TIMEOUT",null));
        loads.stop(manager,"lab",run.id());loads.resource(gateway,"lab",t,resource(run.id(),false,1));
        assertNotNull(loads.resource(gateway,"lab",t,resource(run.id(),false,0)),"client timeout must not release a still active execution");
        var snapshot=loads.snapshot(manager,"lab",run.id(),null,null);
        assertEquals(240,snapshot.requests().getFirst().elapsedSeconds());assertFalse(snapshot.samples().isEmpty());
    }
    @Test void permissionsInvalidUsageAndMissingProfile() {
        String t=terminal();
        assertThrows(AccessPolicy.Forbidden.class,()->loads.start(gateway,"lab",new Start("signal",List.of(t),5,31,"small","LOCAL")));
        assertThrows(WorkflowException.class,()->loads.start(manager,"lab",new Start("absent",List.of(t),5,31,"small","LOCAL")));
        assertThrows(WorkflowException.class,()->loads.resource(gateway,"lab",t,new Resource(-1.0,1,0,.5,100,null,false,0)));
    }
}

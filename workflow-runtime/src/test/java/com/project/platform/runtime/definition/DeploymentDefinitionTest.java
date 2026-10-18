package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.WorkflowException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DeploymentDefinitionTest {
    private final FlowParser parser=new FlowParser(new FlowValidator(new TemplateRenderer()));
    private final String source="""
        schemaVersion: 1
        namespace: lab
        id: services
        tasks:
          - id: cloud
            type: platform.Deployment
            timeout: PT3M
            container:
              applicationId: resident
              version: v1
              candidateClusters: [cloud]
              resources: {limits: {cpu: '2', memory: 1Gi}}
            deployment:
              name: resident-cloud
              readiness: {path: /health, port: 8080}
              service: {port: 8080, targetPort: 8080, nodePort: 31101, endpoint: 'http://cloud:31101'}
          - id: edge
            type: platform.Deployment
            timeout: PT3M
            container:
              applicationId: resident
              version: v1
              candidateClusters: [edge-a]
              parameters:
                CLOUD_URL: {source: TASK_OUTPUT, taskId: cloud, port: endpoint}
            deployment: {name: resident-edge}
        outputs:
          cloud: {source: TASK_OUTPUT, taskId: cloud, port: endpoint}
        """;
    @Test void sharedBindingsAndSchemaRoundTrip() {
        var flow=parser.parse(source);
        assertEquals(1,flow.tasks().getFirst().deployment().replicas());
        assertEquals(flow,parser.parse(new JsonCodec().write(flow)));
        assertTrue(new FlowSchema().generate().toString().contains("platform.Deployment"));
    }
    @Test void warmDeploymentReusesAutoscalingFieldsAndRoundTrips() {
        String warm=source.replace("name: resident-cloud","name: resident-cloud\n      warmPool: true\n      autoscaling: {minReplicas: 1, maxReplicas: 4, cpuUtilization: 60}");
        var flow=parser.parse(warm);
        assertTrue(flow.tasks().getFirst().deployment().warmPool());
        assertEquals(4,flow.tasks().getFirst().deployment().autoscaling().maxReplicas());
        assertEquals(flow,parser.parse(new JsonCodec().write(flow)));
        for(String invalid:new String[]{warm.replace("maxReplicas: 4","maxReplicas: 21"),warm.replace("minReplicas: 1","minReplicas: 5"),warm.replace("cpuUtilization: 60","cpuUtilization: 0")})
            assertThrows(WorkflowException.class,()->parser.parse(invalid));
    }
    @Test void rejectsJobFieldsAndAmbiguousClusterButRetainsSharedValidation() {
        for(String invalid:new String[]{source.replace("[cloud]","[cloud, edge-a]"),source.replace("[cloud]","[]"),
                source.replace("resources: {limits:","outputFiles: [result.json]\n      resources: {limits:"),
                source.replace("cpu: '2'","cpu: invalid"),source.replace("port: endpoint","port: deploymentName"),
                source.replace("name: resident-cloud","name: Invalid"),source.replace("targetPort: 8080","targetPort: 0"),
                source.replace("http://cloud:31101","file:///tmp/data"),source.replace("type: platform.Deployment","type: platform.Application")})
            assertThrows(WorkflowException.class,()->parser.parse(invalid),invalid);
    }
}

package com.project.platform.server;

import com.project.platform.dataflow.execution.ExecutionArtifactCleanup;
import com.project.platform.resource.storage.ObjectStorage;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.persistence.JdbcExecutionStore;
import io.minio.*;
import java.io.ByteArrayInputStream;
import java.nio.file.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.*;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class TemporaryOutputCleanupTest {
    private final MySQLContainer<?> mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("cleanup_test").withUsername("test").withPassword("test-only");
    private final GenericContainer<?> minio=new GenericContainer<>("quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z")
            .withEnv("MINIO_ROOT_USER","cleanup-test").withEnv("MINIO_ROOT_PASSWORD","cleanup-test-secret").withCommand("server","/data").withExposedPorts(9000);
    @TempDir static Path directory;
    private JdbcTemplate jdbc;
    private ExecutionService executions;
    private MinioClient s3;
    private ObjectStorage storage;
    private ExecutionArtifactCleanup cleanup;
    @BeforeAll void start() throws Exception {
        mysql.start();minio.start();
        var source=new DriverManagerDataSource(mysql.getJdbcUrl(),mysql.getUsername(),mysql.getPassword());
        Flyway.configure().dataSource(source).locations("classpath:db/migration/runtime").load().migrate();
        jdbc=new JdbcTemplate(source);
        executions=new ExecutionService(new JdbcExecutionStore(jdbc,new TransactionTemplate(new DataSourceTransactionManager(source)),new JsonCodec()));
        Files.writeString(directory.resolve("access"),"cleanup-test");Files.writeString(directory.resolve("secret"),"cleanup-test-secret");
        s3=MinioClient.builder().endpoint(endpoint()).credentials("cleanup-test","cleanup-test-secret").build();
        for(String bucket:List.of("artifacts","edge-artifacts","datasets"))s3.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        storage=storage("artifacts");cleanup=new ExecutionArtifactCleanup(executions,storage,Set.of("prepared.pt"));
    }
    @AfterAll void stop() throws Exception {if(s3!=null)s3.close();minio.stop();mysql.stop();}
    private String endpoint(){return "http://"+minio.getHost()+":"+minio.getMappedPort(9000);}
    private ObjectStorage storage(String bucket) {
        var center=new ObjectStorage.Connection(endpoint(),null,directory.resolve("access").toString(),directory.resolve("secret").toString(),bucket,Set.of("datasets"));
        var edge=new ObjectStorage.Connection(endpoint(),null,center.accessKeyFile(),center.secretKeyFile(),"edge-artifacts",Set.of());
        return new ObjectStorage(Map.of("lab",new ObjectStorage.Configuration(Map.of("center",center,"edge",edge),Map.of("cloud","center","edge","edge"),"center")));
    }
    private String submit() {
        var flow=new FlowParser(new FlowValidator(new TemplateRenderer())).parse("""
                schemaVersion: 1
                namespace: lab
                id: cleanup-test
                tasks:
                  - id: preprocess
                    type: platform.Application
                    timeout: PT60S
                    container: {applicationId: sample, version: v1, candidateClusters: [edge], command: [echo, test], outputFiles: [prepared.pt, model.pt, report.json]}
                  - {id: train, type: core.Log, message: reading}
                afterExecution:
                  - {id: after, type: core.Log, message: reading}
                """);
        return executions.submit(flow,1,"test",UUID.randomUUID().toString(),"test",new BindingResolver.Prepared(Map.of(),Map.of()));
    }
    private String key(String id,int attempt,String name) {
        String task=jdbc.queryForObject("SELECT id FROM wf_task_run WHERE execution_id=? AND task_id='preprocess'",String.class,id);
        return "lab/"+id+"/"+task+"/"+attempt+"/"+name;
    }
    private void put(String bucket,String key) throws Exception {
        byte[] bytes="test-data".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        s3.putObject(PutObjectArgs.builder().bucket(bucket).object(key).stream(new ByteArrayInputStream(bytes),bytes.length,-1).build());
    }
    private boolean exists(String bucket,String key) throws Exception {
        for(var item:s3.listObjects(ListObjectsArgs.builder().bucket(bucket).prefix(key).recursive(true).build()))if(item.get().objectName().equals(key))return true;
        return false;
    }
    private boolean cleaned(String id){return jdbc.queryForObject("SELECT temporary_outputs_cleaned FROM wf_execution WHERE id=?",Boolean.class,id);}
    private void finish(String id,String state) {
        jdbc.update("UPDATE wf_task_run SET state=? WHERE execution_id=?",state,id);
        jdbc.update("UPDATE wf_execution SET state=?,ended_at=CURRENT_TIMESTAMP(6) WHERE id=?",state,id);
    }
    @Test void retainsRunningAndAfterExecutionInputsThenDeletesOnlyTemporaryFilesAcrossStores() throws Exception {
        String id=submit(),other=submit(),prepared=key(id,1,"prepared.pt"),retry=key(id,2,"prepared.pt"),model=key(id,1,"model.pt"),report=key(id,1,"report.json");
        for(String bucket:List.of("artifacts","edge-artifacts")) {
            for(String key:List.of(prepared,retry,model,report,key(other,1,"prepared.pt"),prepared+".backup","other/"+prepared,prepared+"/nested"))put(bucket,key);
        }
        put("datasets",prepared);
        cleanup.runBatch();assertTrue(exists("artifacts",prepared));assertFalse(cleaned(id));
        finish(id,"SUCCESS");jdbc.update("UPDATE wf_task_run SET state='CREATED' WHERE execution_id=? AND phase='AFTER_EXECUTION'",id);
        cleanup.runBatch();assertTrue(exists("artifacts",prepared));assertFalse(cleaned(id));
        var before=executions.get("lab",id);
        jdbc.update("UPDATE wf_task_run SET state='SUCCESS' WHERE execution_id=? AND phase='AFTER_EXECUTION'",id);
        cleanup.runBatch();assertTrue(cleaned(id));assertEquals(before,executions.get("lab",id));
        for(String bucket:List.of("artifacts","edge-artifacts")) {
            assertFalse(exists(bucket,prepared));assertFalse(exists(bucket,retry));
            for(String key:List.of(model,report,key(other,1,"prepared.pt"),prepared+".backup","other/"+prepared,prepared+"/nested"))assertTrue(exists(bucket,key),key);
        }
        assertTrue(exists("datasets",prepared));
        cleanup.runBatch();assertTrue(cleaned(id));assertFalse(cleaned(other));
        finish(other,"SUCCESS");cleanup.runBatch();
    }
    @Test void failedKilledAndSoftDeletedExecutionsAreAlsoCleaned() throws Exception {
        for(String state:List.of("FAILED","KILLED")) {
            String id=submit(),key=key(id,1,"prepared.pt");put("artifacts",key);finish(id,state);
            executions.remove("lab",id);
            cleanup.runBatch();assertFalse(exists("artifacts",key));assertTrue(cleaned(id));
            assertEquals(state,jdbc.queryForObject("SELECT state FROM wf_execution WHERE id=?",String.class,id));
        }
    }
    @Test void storageFailureRetainsRetryMarkerAndCanResumeAfterServiceRestart() throws Exception {
        String id=submit(),key=key(id,1,"prepared.pt");put("artifacts",key);finish(id,"SUCCESS");
        new ExecutionArtifactCleanup(executions,storage("missing-bucket"),Set.of("prepared.pt")).runBatch();
        assertFalse(cleaned(id));assertTrue(exists("artifacts",key));
        new ExecutionArtifactCleanup(executions,storage,Set.of("prepared.pt")).runBatch();
        assertTrue(cleaned(id));assertFalse(exists("artifacts",key));
    }
    @Test void emptyPolicyDoesNotRemoveOrMarkOutputs() throws Exception {
        String id=submit(),key=key(id,1,"prepared.pt");put("artifacts",key);finish(id,"SUCCESS");
        new ExecutionArtifactCleanup(executions,storage,Set.of()).runBatch();
        assertFalse(cleaned(id));assertTrue(exists("artifacts",key));cleanup.runBatch();
    }
    @Test void rejectsBroadDeletionScopes() {
        assertThrows(IllegalArgumentException.class,()->storage.removeTemporaryOutputs("lab","",Set.of("prepared.pt")));
        assertThrows(RuntimeException.class,()->storage.removeTemporaryOutputs("../lab",UUID.randomUUID().toString(),Set.of("prepared.pt")));
        assertThrows(RuntimeException.class,()->storage.removeTemporaryOutputs("lab",UUID.randomUUID().toString(),Set.of("*")));
    }
}

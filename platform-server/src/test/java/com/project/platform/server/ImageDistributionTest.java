package com.project.platform.server;

import com.project.platform.deployment.application.*;
import com.project.platform.deployment.distribution.*;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.runtime.definition.JsonCodec;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.testcontainers.containers.*;
import org.testcontainers.images.builder.Transferable;
import org.testcontainers.k3s.K3sContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;
import org.testcontainers.DockerClientFactory;
import com.project.platform.deployment.service.DeploymentService;
import io.fabric8.kubernetes.client.*;
import io.fabric8.kubernetes.api.model.NamespaceBuilder;
import java.nio.file.*;
import java.time.Duration;
import static org.awaitility.Awaitility.await;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.runtime.executor.FlowExecutor;
import com.project.platform.runtime.worker.*;
import com.project.platform.runtime.model.ExecutionState;
import com.project.platform.runtime.persistence.JdbcWorkerStore;
import java.util.concurrent.*;
import org.springframework.jdbc.core.JdbcTemplate;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ImageDistributionTest {
    private final Network network=Network.newNetwork();
    private final MySQLContainer<?> mysql=new MySQLContainer<>("mysql:8.0").withDatabaseName("s4_distribution")
            .withUsername("backend_test").withPassword("isolated-test-only").withUrlParam("socketTimeout","1500").withUrlParam("connectTimeout","1500");
    private final String password="isolated-registry-test";
    private final String auth=Base64.getEncoder().encodeToString(("test:"+password).getBytes(StandardCharsets.UTF_8));
    private final GenericContainer<?> source=registry("source"),target=registry("target");
    private final GenericContainer<?> tool=new GenericContainer<>("quay.io/skopeo/stable:v1.20.0")
            .withNetwork(network).withCreateContainerCmdModifier(cmd->cmd.withEntrypoint("/bin/sh"))
            .withCommand("-c","exec sleep infinity");
    private final HttpClient http=HttpClient.newHttpClient();
    private final JsonCodec json=new JsonCodec();
    private final Actor actor=new Actor("writer",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private final GenericContainer<?> storage=new GenericContainer<>("quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z")
            .withEnv("MINIO_ROOT_USER","s4-test-key").withEnv("MINIO_ROOT_PASSWORD","s4-test-secret").withCommand("server","/data").withExposedPorts(9000);
    private Path accessKey,secretKey;
    private ConfigurableApplicationContext context;
    private String fixtureDigest;
    private final K3sContainer kubernetes=new K3sContainer(DockerImageName.parse("rancher/k3s:v1.30.6-k3s1"))
            .withNetwork(network).withStartupTimeout(Duration.ofMinutes(3));
    private Path kubeconfig;
    private KubernetesClient admin;
    private List<String> applicationArguments;

    private GenericContainer<?> registry(String alias) {
        return new GenericContainer<>("registry:2").withNetwork(network).withNetworkAliases(alias).withExposedPorts(5000)
                .withEnv("REGISTRY_AUTH","htpasswd").withEnv("REGISTRY_AUTH_HTPASSWD_REALM","s4-test")
                .withEnv("REGISTRY_AUTH_HTPASSWD_PATH","/auth/htpasswd")
                .withCopyToContainer(Transferable.of("test:"+new BCryptPasswordEncoder().encode(password)+"\n"),"/auth/htpasswd");
    }
    @BeforeAll void start() throws Exception {
        try {
            mysql.start();source.start();target.start();tool.start();storage.start();
            accessKey=Files.createTempFile("cea-s4-s3-key-",".txt");secretKey=Files.createTempFile("cea-s4-s3-secret-",".txt");
            Files.writeString(accessKey,"s4-test-key");Files.writeString(secretKey,"s4-test-secret");
            try(var s3=s3()) {
                s3.makeBucket(io.minio.MakeBucketArgs.builder().bucket("artifacts").build());
                s3.makeBucket(io.minio.MakeBucketArgs.builder().bucket("datasets").build());
                byte[] data="actual dataset bytes\n".getBytes(StandardCharsets.UTF_8);
                s3.putObject(io.minio.PutObjectArgs.builder().bucket("datasets").object("sample/v1/data.txt").stream(new java.io.ByteArrayInputStream(data),data.length,-1).build());
            }
            tool.copyFileToContainer(Transferable.of(json.write(Map.of("auths",Map.of("source:5000",Map.of("auth",auth),"target:5000",Map.of("auth",auth))))),"/tmp/auth.json");
            tool.copyFileToContainer(Transferable.of("{\"auths\":{}}"),"/tmp/empty-auth.json");
            fixtureDigest=seed();
            kubernetes.withCopyToContainer(Transferable.of("""
                    mirrors:
                      "target:5000":
                        endpoint: ["http://target:5000"]
                    configs:
                      "target:5000":
                        auth:
                          username: test
                          password: isolated-registry-test
                    """),"/etc/rancher/k3s/registries.yaml");
            // Seed the real pause image; pod sandbox creation must not depend on Docker Hub during assertions.
            String pause=new org.testcontainers.images.RemoteDockerImage(DockerImageName.parse("rancher/mirrored-pause:3.6")).get();
            Path pauseArchive=Files.createTempFile("cea-s4-pause-",".tar");
            try(var content=DockerClientFactory.instance().client().saveImageCmd(pause).exec()) {
                Files.copy(content,pauseArchive,StandardCopyOption.REPLACE_EXISTING);
                kubernetes.withCopyFileToContainer(MountableFile.forHostPath(pauseArchive),"/var/lib/rancher/k3s/agent/images/s4-pause.tar");
                kubernetes.start();
            } finally {Files.deleteIfExists(pauseArchive);}
            kubeconfig=Files.createTempFile("cea-s4-kube-",".yaml");
            admin=new KubernetesClientBuilder().withConfig(Config.fromKubeconfig(kubernetes.getKubeConfigYaml())).build();
            admin.namespaces().resource(new NamespaceBuilder().withNewMetadata().withName("s4-test").endMetadata().build()).create();
            admin.load(new java.io.ByteArrayInputStream("""
                    apiVersion: v1
                    kind: ServiceAccount
                    metadata: {name: cea-backend, namespace: s4-test}
                    ---
                    apiVersion: rbac.authorization.k8s.io/v1
                    kind: Role
                    metadata: {name: cea-deployments, namespace: s4-test}
                    rules:
                      - apiGroups: [apps]
                        resources: [deployments]
                        verbs: [get, list, create, update, delete]
                      - apiGroups: [batch]
                        resources: [jobs]
                        verbs: [get, list, create, update, patch]
                      - apiGroups: [""]
                        resources: [pods]
                        verbs: [get, list]
                      - apiGroups: [""]
                        resources: [pods/exec]
                        verbs: [get, create]
                    ---
                    apiVersion: rbac.authorization.k8s.io/v1
                    kind: RoleBinding
                    metadata: {name: cea-deployments, namespace: s4-test}
                    subjects: [{kind: ServiceAccount, name: cea-backend, namespace: s4-test}]
                    roleRef: {apiGroup: rbac.authorization.k8s.io, kind: Role, name: cea-deployments}
                    ---
                    apiVersion: rbac.authorization.k8s.io/v1
                    kind: ClusterRole
                    metadata: {name: cea-observe-nodes}
                    rules:
                      - apiGroups: [""]
                        resources: [nodes]
                        verbs: [list]
                    ---
                    apiVersion: rbac.authorization.k8s.io/v1
                    kind: ClusterRoleBinding
                    metadata: {name: cea-observe-nodes}
                    subjects: [{kind: ServiceAccount, name: cea-backend, namespace: s4-test}]
                    roleRef: {apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: cea-observe-nodes}
                    """.getBytes(StandardCharsets.UTF_8))).create();
            var token=kubernetes.execInContainer("kubectl","create","token","cea-backend","-n","s4-test","--duration=30m");
            assertEquals(0,token.getExitCode());
            var restricted=new LinkedHashMap<String,Object>(new tools.jackson.dataformat.yaml.YAMLMapper().readValue(kubernetes.getKubeConfigYaml(),Map.class));
            restricted.put("users",List.of(Map.of("name","default","user",Map.of("token",token.getStdout().trim()))));
            Files.writeString(kubeconfig,json.write(restricted));
            Path archive=Files.createTempFile("cea-s4-alpine-",".tar");
            String alpine=new org.testcontainers.images.RemoteDockerImage(DockerImageName.parse("alpine:latest")).get();
            try(var content=DockerClientFactory.instance().client().saveImageCmd(alpine).exec()) {
                Files.copy(content,archive,StandardCopyOption.REPLACE_EXISTING);
                tool.copyFileToContainer(MountableFile.forHostPath(archive),"/tmp/alpine.tar");
            } finally {Files.deleteIfExists(archive);}
            var seedImage=tool.execInContainer("skopeo","--command-timeout=60s","copy","--dest-tls-verify=false","--dest-authfile=/tmp/auth.json",
                    "docker-archive:/tmp/alpine.tar","docker://source:5000/alpine:v1");
            assertEquals(0,seedImage.getExitCode(),seedImage.getStderr());
            Path pythonArchive=Files.createTempFile("cea-s4-python-",".tar");
            String python=new org.testcontainers.images.RemoteDockerImage(DockerImageName.parse("python:3.11-slim")).get();
            try(var content=DockerClientFactory.instance().client().saveImageCmd(python).exec()) {
                Files.copy(content,pythonArchive,StandardCopyOption.REPLACE_EXISTING);tool.copyFileToContainer(MountableFile.forHostPath(pythonArchive),"/tmp/python.tar");
            } finally {Files.deleteIfExists(pythonArchive);}
            var pythonSeed=tool.execInContainer("skopeo","--command-timeout=60s","copy","--dest-tls-verify=false","--dest-authfile=/tmp/auth.json","docker-archive:/tmp/python.tar","docker://source:5000/python:v1");
            assertEquals(0,pythonSeed.getExitCode(),pythonSeed.getStderr());
            var args=new ArrayList<>(List.of("--server.port=0","--platform.executor.enabled=false","--platform.worker.enabled=false","--platform.scheduler.enabled=false",
                    "--spring.datasource.url="+mysql.getJdbcUrl(),"--spring.datasource.username="+mysql.getUsername(),"--spring.datasource.password="+mysql.getPassword(),
                    "--platform.security.users[0].name=writer","--platform.security.users[0].password=test-api","--platform.security.users[0].namespaces=lab",
                    "--platform.security.users[0].actions=READ,WRITE,EXECUTE","--platform.security.users[1].name=viewer","--platform.security.users[1].password=test-api",
                    "--platform.security.users[1].namespaces=lab","--platform.security.users[1].actions=READ","--logging.level.root=WARN",
                    "--platform.distribution.registries.source.address=source:5000","--platform.distribution.registries.source.tls-verify=false",
                    "--platform.distribution.registries.source.auth-file=/tmp/auth.json","--platform.distribution.registries.target.address=target:5000",
                    "--platform.distribution.registries.target.tls-verify=false","--platform.distribution.registries.target.auth-file=/tmp/auth.json",
                    "--platform.distribution.targets.lab.edge=target","--platform.distribution.timeout=PT30S"));
            args.addAll(List.of("--platform.kubernetes.connections.lab.edge.kubeconfig="+kubeconfig,
                    "--platform.kubernetes.connections.lab.edge.context=default","--platform.kubernetes.connections.lab.edge.namespace=s4-test"));
            args.addAll(List.of("--platform.jobs.slots.lab.edge=1","--platform.jobs.storage.lab.endpoint="+storageEndpoint(),
                    "--platform.jobs.storage.lab.access-key-file="+accessKey,"--platform.jobs.storage.lab.secret-key-file="+secretKey,
                    "--platform.jobs.storage.lab.artifact-bucket=artifacts","--platform.jobs.storage.lab.readable-buckets=datasets"));
            var command=List.of("docker","exec",tool.getContainerId(),"skopeo");
            for(int i=0;i<command.size();i++) args.add("--platform.distribution.command["+i+"]="+command.get(i));
            applicationArguments=List.copyOf(args);context=new SpringApplicationBuilder(BackendApplication.class).run(args.toArray(String[]::new));
            resources().putCluster(actor,"lab","edge",new Cluster("edge",Kind.EDGE,true));
            resources().registerDataset(actor,"lab","sample","v1",new DatasetVersion("sample","v1","txt",List.of(new Location("edge","s3://datasets/sample/v1/data.txt"))));
            applications().register(actor,"lab","sample","v1",new ApplicationVersion("sample","v1","source:5000/fixture:v1",Map.of()));
            applications().register(actor,"lab","service","v1",new ApplicationVersion("service","v1","source:5000/alpine:v1",
                    Map.of("GREETING",new ApplicationVersion.Parameter(ApplicationVersion.ValueType.STRING,true,"hello",List.of(),null))));
            applications().register(actor,"lab","python","v1",new ApplicationVersion("python","v1","source:5000/python:v1",Map.of()));
        } catch(Exception ex) { close();throw ex; }
    }
    @AfterAll void close() {
        if(context!=null)context.close();if(admin!=null)admin.close();kubernetes.stop();tool.stop();target.stop();source.stop();storage.stop();mysql.stop();network.close();
        if(kubeconfig!=null)try{Files.deleteIfExists(kubeconfig);}catch(java.io.IOException ex){throw new RuntimeException(ex);}
        for(Path file:new Path[]{accessKey,secretKey})if(file!=null)try{Files.deleteIfExists(file);}catch(java.io.IOException ex){throw new RuntimeException(ex);}
    }
    private String storageEndpoint(){return "http://"+storage.getHost()+":"+storage.getMappedPort(9000);}
    private io.minio.MinioClient s3(){return io.minio.MinioClient.builder().endpoint(storageEndpoint()).credentials("s4-test-key","s4-test-secret").build();}
    private ResourceCatalogService resources() { return context.getBean(ResourceCatalogService.class); }
    private ApplicationCatalogService applications() { return context.getBean(ApplicationCatalogService.class); }
    private ImageDistributionService distribution() { return context.getBean(ImageDistributionService.class); }
    private String endpoint(GenericContainer<?> registry) { return "http://"+registry.getHost()+":"+registry.getMappedPort(5000); }
    private HttpResponse<byte[]> registryCall(String method,String path,byte[] body,String contentType) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(path)).header("Authorization","Basic "+auth).header("Content-Type",contentType)
                .header("Accept","application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json")
                .method(method,HttpRequest.BodyPublishers.ofByteArray(body)).build(),HttpResponse.BodyHandlers.ofByteArray());
    }
    private String hash(byte[] bytes) throws Exception { return "sha256:"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private void blob(byte[] content) throws Exception {
        var upload=registryCall("POST",endpoint(source)+"/v2/fixture/blobs/uploads/",new byte[0],"application/octet-stream");
        assertEquals(202,upload.statusCode());
        String location=upload.headers().firstValue("Location").orElseThrow();
        assertEquals(201,registryCall("PUT",location+(location.contains("?")?"&":"?")+"digest="+hash(content),content,"application/octet-stream").statusCode());
    }
    private String seed() throws Exception {
        // A real tar layer containing an actual fixture file, not a fake manifest-only success.
        var buffer=new java.io.ByteArrayOutputStream();
        try(var tar=new org.apache.commons.compress.archivers.tar.TarArchiveOutputStream(buffer)) {
            byte[] content="S4 image distribution fixture\n".getBytes(StandardCharsets.UTF_8);
            var entry=new org.apache.commons.compress.archivers.tar.TarArchiveEntry("fixture.txt");entry.setSize(content.length);
            tar.putArchiveEntry(entry);tar.write(content);tar.closeArchiveEntry();tar.finish();
        }
        byte[] layer=buffer.toByteArray();
        byte[] config=json.write(Map.of("architecture","amd64","os","linux","rootfs",Map.of("type","layers","diff_ids",List.of(hash(layer))))).getBytes(StandardCharsets.UTF_8);
        blob(config);blob(layer);
        byte[] manifest=json.write(Map.of("schemaVersion",2,"mediaType","application/vnd.oci.image.manifest.v1+json",
                "config",Map.of("mediaType","application/vnd.oci.image.config.v1+json","digest",hash(config),"size",config.length),
                "layers",List.of(Map.of("mediaType","application/vnd.oci.image.layer.v1.tar","digest",hash(layer),"size",layer.length)))).getBytes(StandardCharsets.UTF_8);
        assertEquals(201,registryCall("PUT",endpoint(source)+"/v2/fixture/manifests/v1",manifest,"application/vnd.oci.image.manifest.v1+json").statusCode());
        return hash(manifest);
    }
    @Test void copiesRealLayersAcrossRegistriesAndRepeatsByDigest() throws Exception {
        var prepared=distribution().prepare(actor,"lab","sample","v1","edge");
        assertEquals("target:5000/lab/sample@"+fixtureDigest,prepared.image());
        assertEquals(prepared,distribution().prepare(actor,"lab","sample","v1","edge"));
        var response=registryCall("GET",endpoint(target)+"/v2/lab/sample/manifests/"+fixtureDigest,new byte[0],"application/json");
        assertEquals(200,response.statusCode());
        var manifest=json.map(new String(response.body(),StandardCharsets.UTF_8));
        for(var layer:(List<?>)manifest.get("layers")) {
            String digest=(String)((Map<?,?>)layer).get("digest");
            var data=registryCall("GET",endpoint(target)+"/v2/lab/sample/blobs/"+digest,new byte[0],"application/octet-stream");
            assertEquals(200,data.statusCode());assertEquals(digest,hash(data.body()));
        }
    }
    @Test void rejectsUnconfiguredSourcesTargetsDisabledClustersAndWrongPermissions() {
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->distribution().prepare(new Actor("viewer",Set.of("lab"),Set.of(Action.READ)),"lab","sample","v1","edge"));
        resources().putCluster(actor,"lab","disabled",new Cluster("disabled",Kind.EDGE,false));
        assertThrows(ApplicationException.class,()->distribution().prepare(actor,"lab","sample","v1","disabled"));
        resources().putCluster(actor,"lab","unconfigured",new Cluster("unconfigured",Kind.EDGE,true));
        assertThrows(ApplicationException.class,()->distribution().prepare(actor,"lab","sample","v1","unconfigured"));
        applications().register(actor,"lab","unknown","v1",new ApplicationVersion("unknown","v1","unconfigured.example/test:v1",Map.of()));
        assertThrows(ApplicationException.class,()->distribution().prepare(actor,"lab","unknown","v1","edge"));
    }
    @Test void registryAuthenticationAndMissingImageFailWithoutLeakingCredentials() throws Exception {
        assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(endpoint(source)+"/v2/")).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        var client=new SkopeoImageClient(List.of("docker","exec",tool.getContainerId(),"skopeo"),java.time.Duration.ofSeconds(10));
        var failure=assertThrows(SkopeoImageClient.Failure.class,()->client.digest("source:5000/fixture:v1",new SkopeoImageClient.Registry("source:5000",false,"/tmp/empty-auth.json")));
        assertFalse(failure.getMessage().contains(password));assertFalse(failure.getMessage().contains(auth));
        applications().register(actor,"lab","missing","v1",new ApplicationVersion("missing","v1","source:5000/fixture:missing",Map.of()));
        assertThrows(SkopeoImageClient.Failure.class,()->distribution().prepare(actor,"lab","missing","v1","edge"));
    }
    @Test void preparationHttpChecksIdentityAndReturnsPinnedImage() throws Exception {
        String base="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab/applications/sample/versions/v1/preparations/edge";
        for(String user:List.of("anonymous","viewer","writer")) {
            var request=HttpRequest.newBuilder(URI.create(base)).POST(HttpRequest.BodyPublishers.noBody());
            if(!user.equals("anonymous"))request.header("Authorization","Basic "+Base64.getEncoder().encodeToString((user+":test-api").getBytes(StandardCharsets.UTF_8)));
            var response=http.send(request.build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(user.equals("anonymous")?401:user.equals("viewer")?403:200,response.statusCode(),response.body());
            if(user.equals("writer"))assertTrue(response.body().contains(fixtureDigest));
        }
    }
    private DeploymentService deployments(){return context.getBean(DeploymentService.class);}
    private DeploymentService.Request request(int replicas,String revision,List<String> command){
        return new DeploymentService.Request("service","v1",replicas,Map.of(),command,revision);
    }
    @Test void deploymentRunsUpdatesStopsAndDeletesWithOptimisticConcurrency() {
        var command=List.of("/bin/sh","-c","test \"$GREETING\" = hello && exec sleep 300");
        var created=deployments().put(actor,"lab","edge","service",request(1,null,command));
        assertTrue(created.image().contains("@sha256:"));
        await().atMost(Duration.ofSeconds(120)).untilAsserted(()->{
            var actual=deployments().get(actor,"lab","edge","service");assertTrue(actual.observed());assertEquals(1,actual.readyReplicas());
        });
        assertTrue(deployments().list(actor,"lab","edge").stream().anyMatch(d->d.name().equals("service")));
        assertThrows(ApplicationException.class,()->deployments().put(actor,"lab","edge","service",request(0,"stale",command)));
        var current=deployments().get(actor,"lab","edge","service");
        deployments().put(actor,"lab","edge","service",request(0,current.resourceVersion(),command));
        await().atMost(Duration.ofSeconds(45)).untilAsserted(()->{
            var stopped=deployments().get(actor,"lab","edge","service");assertTrue(stopped.observed());assertEquals(0,stopped.replicas());assertEquals(0,stopped.readyReplicas());
        });
        assertThrows(ApplicationException.class,()->deployments().delete(actor,"lab","edge","service",current.resourceVersion()));
        deployments().delete(actor,"lab","edge","service",deployments().get(actor,"lab","edge","service").resourceVersion());
        await().atMost(Duration.ofSeconds(30)).until(()->admin.apps().deployments().inNamespace("s4-test").withName("service").get()==null);
    }
    @Test void failedDeploymentIsNotReportedReadyAndCannotBeOverwrittenAcrossOwners() {
        deployments().put(actor,"lab","edge","broken",request(1,null,List.of("/bin/sh","-c","exit 7")));
        await().atMost(Duration.ofSeconds(90)).until(()->admin.pods().inNamespace("s4-test").withLabel("cea-system/deployment","broken").list().getItems().stream()
                .anyMatch(p->p.getStatus().getContainerStatuses()!=null && p.getStatus().getContainerStatuses().stream().anyMatch(s->s.getRestartCount()>0)));
        assertEquals(0,deployments().get(actor,"lab","edge","broken").readyReplicas());
        var foreign=admin.apps().deployments().inNamespace("s4-test").withName("broken").get();
        foreign.getMetadata().getLabels().put("cea-system/owner","foreign");
        admin.apps().deployments().inNamespace("s4-test").resource(foreign).replace();
        assertThrows(ApplicationException.class,()->deployments().get(actor,"lab","edge","broken"));
        assertThrows(ApplicationException.class,()->deployments().delete(actor,"lab","edge","broken",foreign.getMetadata().getResourceVersion()));
        assertThrows(ApplicationException.class,()->deployments().put(actor,"lab","edge","broken",request(0,foreign.getMetadata().getResourceVersion(),List.of())));
        admin.apps().deployments().inNamespace("s4-test").withName("broken").delete();
    }
    @Test void deploymentRejectsBadParametersUnconfiguredClusterAndReadOnlyActor() {
        assertThrows(ApplicationException.class,()->deployments().put(actor,"lab","edge","invalid",new DeploymentService.Request("service","v1",1,Map.of("UNKNOWN",1),List.of(),null)));
        assertThrows(ApplicationException.class,()->deployments().put(actor,"lab","edge","invalid",new DeploymentService.Request("service","v1",1,Map.of("GREETING",1),List.of(),null)));
        assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->deployments().put(new Actor("viewer",Set.of("lab"),Set.of(Action.READ)),"lab","edge","denied",request(1,null,List.of())));
        resources().putCluster(actor,"lab","not-connected",new Cluster("not-connected",Kind.EDGE,true));
        assertThrows(ResourceException.class,()->deployments().list(actor,"lab","not-connected"));
        assertNull(admin.apps().deployments().inNamespace("s4-test").withName("invalid").get());
    }
    @Test void deploymentApiAndKubernetesCredentialsEnforceTheirOwnBoundaries() throws Exception {
        String base="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab/clusters/edge/deployments";
        assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base)).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        String viewer="Basic "+Base64.getEncoder().encodeToString("viewer:test-api".getBytes(StandardCharsets.UTF_8));
        assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(base)).header("Authorization",viewer).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+"/denied")).header("Authorization",viewer).header("Content-Type","application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json.write(request(0,null,List.of())))).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        try(var restricted=context.getBean(com.project.platform.resource.kubernetes.KubernetesConnections.class).open("lab","edge")) {
            assertFalse(restricted.nodes().list().getItems().isEmpty());
            assertEquals(403,assertThrows(KubernetesClientException.class,()->restricted.namespaces().list()).getCode());
            assertEquals(403,assertThrows(KubernetesClientException.class,()->restricted.apps().deployments().inNamespace("default").list()).getCode());
        }
    }
    private FlowExecutionService executions(){return context.getBean(FlowExecutionService.class);}
    private String submit(String tasks) {
        String id="job"+UUID.randomUUID().toString().replace("-","");
        String source="schemaVersion: 1\nnamespace: lab\nid: "+id+"\n"+tasks;
        context.getBean(FlowService.class).save(actor,"lab",id,0,source);
        return executions().submit(actor,"lab",UUID.randomUUID().toString(),new FlowExecutionService.Request(id,null,Map.of()));
    }
    private void drive(String id) throws Exception {
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var stop=new java.util.concurrent.atomic.AtomicBoolean();
            var worker=pool.submit(()->{while(!stop.get()){context.getBean(WorkerEngine.class).runOnce();Thread.sleep(20);}return null;});
            try {
                await().atMost(Duration.ofSeconds(90)).pollInterval(Duration.ofMillis(50)).until(()->{
                    context.getBean(FlowExecutor.class).processNext();return executions().get(actor,"lab",id).state().terminal();
                });
            } finally {stop.set(true);try{worker.get(5,TimeUnit.SECONDS);}catch(TimeoutException timeout){worker.cancel(true);}}
        }
    }
    @Test void applicationRunsRealDatasetAndNamedArtifactChain() throws Exception {
        applications().register(actor,"lab","reader","v1",new ApplicationVersion("reader","v1","source:5000/alpine:v1",Map.of(
                "DATASET",new ApplicationVersion.Parameter(ApplicationVersion.ValueType.STRING,true,"sample/v1",List.of(),new ApplicationVersion.DatasetRule("txt",List.of(new ApplicationVersion.DatasetRef("sample","v1")))))));
        String id=submit("""
                tasks:
                  - id: first
                    type: platform.Application
                    timeout: PT60S
                    container:
                      applicationId: reader
                      version: v1
                      candidateClusters: [edge]
                      command: [sh, -c, 'cat "$DATASET_PATH" > /cea-work/out/data.txt']
                      outputFiles: [data.txt]
                  - id: second
                    type: platform.Application
                    timeout: PT60S
                    container:
                      applicationId: service
                      version: v1
                      candidateClusters: [edge]
                      command: [sh, -c, 'printf "%s\\n" "$GREETING" > /cea-work/out/result.txt; cat /cea-work/in/source >> /cea-work/out/result.txt']
                      inputFiles:
                        source: {source: TASK_OUTPUT, taskId: first, port: data.txt}
                      outputFiles: [result.txt]
                outputs:
                  result: {source: TASK_OUTPUT, taskId: second, port: result.txt}
                """);
        drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state(),executions().get(actor,"lab",id).error());
        String uri=executions().get(actor,"lab",id).outputs().get("result").toString();
        try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(uri).getPath().substring(1)).build())) {
            assertEquals("hello\nactual dataset bytes\n",new String(input.readAllBytes(),StandardCharsets.UTF_8));
        }
        assertTrue(executions().get(actor,"lab",id).definition().inputs().isEmpty());
        for(var task:executions().tasks(actor,"lab",id)) {
            assertEquals(1,executions().attempts(actor,"lab",id,task.id()).size());
            var job=admin.batch().v1().jobs().inNamespace("s4-test").withName("cea-"+task.id()+"-a1").get();
            assertEquals(0,job.getSpec().getBackoffLimit());
            assertTrue(job.getSpec().getTemplate().getSpec().getContainers().getFirst().getImage().contains("@sha256:"));
            assertTrue(job.getSpec().getTemplate().getSpec().getContainers().getFirst().getEnv().stream().noneMatch(e->e.getName().contains("SECRET")||e.getName().contains("ACCESS_KEY")));
        }
        assertEquals(0,context.getBean(JdbcTemplate.class).queryForObject("SELECT COUNT(*) FROM res_job_reservation WHERE released=FALSE",Integer.class));
    }
    @Test void applicationMissingOutputFailsRatherThanPublishingSuccess() throws Exception {
        String id=submit("""
                tasks:
                  - id: missing
                    type: platform.Application
                    timeout: PT30S
                    container:
                      applicationId: service
                      version: v1
                      candidateClusters: [edge]
                      command: [sh, -c, 'true']
                      outputFiles: [missing.txt]
                """);
        drive(id);assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());
        assertTrue(executions().get(actor,"lab",id).error().contains("output file missing"));
    }
    private String sleeper(String timeout,String command) {return """
            tasks:
              - id: remote
                type: platform.Application
                timeout: %s
                container:
                  applicationId: service
                  version: v1
                  candidateClusters: [edge]
                  command: [sh, -c, '%s']
            finally:
              - {id: cleanup, type: core.Log, message: cleaned}
            """.formatted(timeout,command);}
    private String dispatch(String source) {
        String id=submit(source);
        await().atMost(Duration.ofSeconds(5)).until(()->{
            context.getBean(FlowExecutor.class).processNext();
            return executions().tasks(actor,"lab",id).stream().anyMatch(t->t.state()==ExecutionState.RUNNING);
        });return id;
    }
    private String remoteName(String id) {return "cea-"+executions().tasks(actor,"lab",id).getFirst().id()+"-a1";}
    private boolean activePod(String name) {return admin.pods().inNamespace("s4-test").withLabel("job-name",name).list().getItems().stream().anyMatch(p->"Running".equals(p.getStatus().getPhase()));}
    @Test void applicationWorkerTakeoverKeepsJobUidAndAttempt() throws Exception {
        String id=dispatch(sleeper("PT60S","sleep 5"));String name=remoteName(id);
        var local=new WorkerEngine(context.getBean(JdbcWorkerStore.class),new com.project.platform.runtime.definition.TemplateRenderer(),1000,context.getBean(TaskRunner.class));
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var running=pool.submit(local::runOnce);
            await().atMost(Duration.ofSeconds(30)).until(()->activePod(name));
            String uid=admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid();
            local.close();running.get(5,TimeUnit.SECONDS);
            context.getBean(JdbcTemplate.class).update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",executions().tasks(actor,"lab",id).getFirst().id());
            drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
            assertEquals(uid,admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid());
            assertEquals(1,executions().attempts(actor,"lab",id,executions().tasks(actor,"lab",id).getFirst().id()).size());
        } finally {local.close();}
    }
    @Test void applicationCancellationWaitsForRemoteStopBeforeFinally() throws Exception {
        String id=dispatch(sleeper("PT60S","sleep 40")),name=remoteName(id);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var running=pool.submit(context.getBean(WorkerEngine.class)::runOnce);
            await().atMost(Duration.ofSeconds(30)).until(()->activePod(name));
            executions().cancel(actor,"lab",id);context.getBean(FlowExecutor.class).processNext();
            assertEquals(ExecutionState.KILLING,executions().get(actor,"lab",id).state());
            assertEquals(ExecutionState.CREATED,executions().tasks(actor,"lab",id).getLast().state());
            running.get(20,TimeUnit.SECONDS);drive(id);
        }
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",id).state());
        assertEquals(ExecutionState.SUCCESS,executions().tasks(actor,"lab",id).getLast().state());
        assertFalse(activePod(name));
        assertTrue(admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getSpec().getSuspend());
    }
    @Test void applicationTimeoutStopsTheJobAndReleasesReservation() throws Exception {
        String id=submit(sleeper("PT10S","sleep 40"));drive(id);
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());
        assertEquals("attempt timed out",executions().get(actor,"lab",id).error());
        assertFalse(activePod(remoteName(id)));
        assertEquals(0,context.getBean(JdbcTemplate.class).queryForObject("SELECT COUNT(*) FROM res_job_reservation WHERE released=FALSE",Integer.class));
    }
    @Test void applicationPlacementRespectsSlotsLocalityAndCancellationTombstone() throws Exception {
        var placement=context.getBean(com.project.platform.resource.placement.JobPlacementService.class);
        var request=new PlacementRequest(List.of("edge"),List.of(new DatasetRequirement("sample","v1","txt")));
        String a=UUID.randomUUID().toString(),b=UUID.randomUUID().toString();
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var gate=new CountDownLatch(1);
            var first=pool.submit(()->{gate.await();return placement.reserve(actor,"lab",a,request);});
            var second=pool.submit(()->{gate.await();return placement.reserve(actor,"lab",b,request);});gate.countDown();
            var one=first.get(15,TimeUnit.SECONDS);var two=second.get(15,TimeUnit.SECONDS);
            assertTrue((one==null)!=(two==null),"one configured slot must have exactly one concurrent winner");
            String winner=one==null?b:a,waiting=one==null?a:b;
            placement.release("lab",winner);assertEquals("edge",placement.reserve(actor,"lab",waiting,request).clusterId());
        } finally {placement.release("lab",a);placement.release("lab",b);}
        String cancelled=UUID.randomUUID().toString();placement.release("lab",cancelled);
        assertTrue(placement.reserve(actor,"lab",cancelled,request).released());
        resources().putCluster(actor,"lab","no-data",new Cluster("no-data",Kind.CLOUD,true));
        assertThrows(ResourceException.class,()->placement.reserve(actor,"lab",UUID.randomUUID().toString(),new PlacementRequest(List.of("no-data"),request.datasets())));
    }
    @Test void pythonRunsInsideTheRealContainerAndPublishesComputedOutput() throws Exception {
        String id=submit("""
                tasks:
                  - id: python
                    type: platform.Application
                    timeout: PT60S
                    container:
                      applicationId: python
                      version: v1
                      candidateClusters: [edge]
                      command: [python, -c, 'from pathlib import Path; Path("/cea-work/out/result.txt").write_text(str(sum([1,2,3])))']
                      outputFiles: [result.txt]
                outputs:
                  result: {source: TASK_OUTPUT, taskId: python, port: result.txt}
                """);drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state(),executions().get(actor,"lab",id).error());
        String uri=executions().get(actor,"lab",id).outputs().get("result").toString();
        try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(uri).getPath().substring(1)).build())) {assertEquals("6",new String(input.readAllBytes(),StandardCharsets.UTF_8));}
    }
    @Test void killedWorkerJvmRecoversTheSameRemoteJob() throws Exception {
        String id=dispatch(sleeper("PT90S","sleep 8")),name=remoteName(id);
        var arguments=new ArrayList<>(applicationArguments);arguments.remove("--platform.worker.enabled=false");arguments.add("--platform.worker.enabled=true");
        var command=new ArrayList<>(List.of(Path.of(System.getProperty("java.home"),"bin","java.exe").toString(),"-cp",System.getProperty("surefire.test.class.path",System.getProperty("java.class.path")),BackendApplication.class.getName()));command.addAll(arguments);
        Path log=Path.of("target","deployment-evidence","worker-process.log");Files.createDirectories(log.getParent());Process child=null;
        try {
            child=new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(log.toFile()).start();
            await().atMost(Duration.ofSeconds(45)).until(()->activePod(name));
            String uid=admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid();
            child.destroyForcibly();assertTrue(child.waitFor(10,TimeUnit.SECONDS));
            drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
            assertEquals(uid,admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid());
            assertEquals(1,executions().attempts(actor,"lab",id,executions().tasks(actor,"lab",id).getFirst().id()).size());
        } finally {if(child!=null && child.isAlive()){child.destroyForcibly();assertTrue(child.waitFor(10,TimeUnit.SECONDS));}}
    }
    @Test void databaseOutageDoesNotLoseOrDuplicateAnAcceptedRemoteAttempt() throws Exception {
        String id=dispatch(sleeper("PT60S","sleep 6")),name=remoteName(id);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var running=pool.submit(context.getBean(WorkerEngine.class)::runOnce);
            await().atMost(Duration.ofSeconds(30)).until(()->activePod(name));
            String uid=admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid();
            DockerClientFactory.instance().client().pauseContainerCmd(mysql.getContainerId()).exec();
            try {Thread.sleep(4500);}finally {DockerClientFactory.instance().client().unpauseContainerCmd(mysql.getContainerId()).exec();}
            try{running.get(15,TimeUnit.SECONDS);}catch(ExecutionException unavailable){assertInstanceOf(org.springframework.dao.DataAccessException.class,unavailable.getCause());}
            drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
            assertEquals(uid,admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid());
            assertEquals(1,executions().attempts(actor,"lab",id,executions().tasks(actor,"lab",id).getFirst().id()).size());
        }
    }
}

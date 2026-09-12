package com.project.platform.server;

import com.project.platform.runtime.model.WorkflowException;

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
import com.project.platform.edge.*;
import com.project.platform.edge.EdgeAccess.*;
import com.project.platform.offloading.*;

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
    private GenericContainer<?> federation;
    private String federationImage;
    // Isolated terminal engine. Its unsecured test socket is bound only to host loopback, never production configuration.
    private final GenericContainer<?> terminalEngine=new GenericContainer<>("docker:28-dind").withNetwork(network)
            .withPrivilegedMode(true).withEnv("DOCKER_TLS_CERTDIR","").withExposedPorts(2375)
            .withCommand("--tls=false","--insecure-registry=target:5000")
            .withCreateContainerCmdModifier(cmd->cmd.getHostConfig().withPortBindings(new com.github.dockerjava.api.model.PortBinding(
                    com.github.dockerjava.api.model.Ports.Binding.bindIpAndPort("127.0.0.1",0),new com.github.dockerjava.api.model.ExposedPort(2375))))
            .waitingFor(org.testcontainers.containers.wait.strategy.Wait.forListeningPort()).withStartupTimeout(Duration.ofMinutes(2));
    private final String terminalContext="cea-test-"+UUID.randomUUID();
    private boolean terminalContextCreated;

    private GenericContainer<?> registry(String alias) {
        return new GenericContainer<>("registry:2").withNetwork(network).withNetworkAliases(alias).withExposedPorts(5000)
                .withEnv("REGISTRY_AUTH","htpasswd").withEnv("REGISTRY_AUTH_HTPASSWD_REALM","s4-test")
                .withEnv("REGISTRY_AUTH_HTPASSWD_PATH","/auth/htpasswd")
                .withCopyToContainer(Transferable.of("test:"+new BCryptPasswordEncoder().encode(password)+"\n"),"/auth/htpasswd");
    }
    @BeforeAll void start() throws Exception {
        try {
            mysql.start();source.start();target.start();tool.start();storage.start();
            terminalEngine.start();
            await().atMost(Duration.ofSeconds(30)).until(()->terminalEngine.execInContainer("docker","info").getExitCode()==0);
            dockerCli("context","create",terminalContext,"--docker","host=tcp://127.0.0.1:"+terminalEngine.getMappedPort(2375));terminalContextCreated=true;
            assertEquals(0,terminalEngine.execInContainer("docker","login","target:5000","--username","test","--password",password).getExitCode());
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
                        resources: [pods, services]
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
                        resources: [namespaces]
                        resourceNames: [s4-test]
                        verbs: [get]
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
                    "--platform.security.users[2].name=gateway","--platform.security.users[2].password=test-api","--platform.security.users[2].namespaces=lab",
                    "--platform.security.users[2].actions=CONNECT","--platform.jobs.terminals.lab.pc.docker-context="+terminalContext,
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
            edge().putGateway(actor,"lab","gateway",new GatewayRegistration("edge","gateway",true));
            edge().putTerminal(actor,"lab","pc",new TerminalRegistration("gateway",true));
        } catch(Exception ex) { close();throw ex; }
    }
    @AfterAll void close() {
        terminalEngine.stop();
        if(terminalContextCreated)try{dockerCli("context","rm","--force",terminalContext);terminalContextCreated=false;}catch(Exception ex){throw new RuntimeException(ex);}
        if(context!=null)context.close();if(admin!=null)admin.close();if(federation!=null)federation.stop();kubernetes.stop();tool.stop();target.stop();source.stop();storage.stop();mysql.stop();network.close();
        if(federationImage!=null)DockerClientFactory.instance().client().removeImageCmd(federationImage).exec();
        if(kubeconfig!=null)try{Files.deleteIfExists(kubeconfig);}catch(java.io.IOException ex){throw new RuntimeException(ex);}
        for(Path file:new Path[]{accessKey,secretKey})if(file!=null)try{Files.deleteIfExists(file);}catch(java.io.IOException ex){throw new RuntimeException(ex);}
    }
    private void dockerCli(String... arguments) throws Exception {
        var command=new ArrayList<>(List.of("docker"));command.addAll(List.of(arguments));
        Path log=Files.createTempFile("cea-docker-fixture-",".log");Process process=null;
        try {process=new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(log.toFile()).start();
            assertTrue(process.waitFor(30,TimeUnit.SECONDS));assertEquals(0,process.exitValue(),Files.readString(log));
        } finally {if(process!=null && process.isAlive())process.destroyForcibly();Files.deleteIfExists(log);}
    }
    private EdgeAccessService edge(){return context.getBean(EdgeAccessService.class);}
    private void primeTerminal(String application) throws Exception {
        String image=distribution().prepare(actor,"lab",application,"v1","edge").image();
        var pulled=terminalEngine.execInContainer("docker","pull",image);assertEquals(0,pulled.getExitCode(),pulled.getStderr());
    }
    private String terminalSubmit(String tasks) throws Exception {
        primeTerminal("service");
        String flow="terminal"+UUID.randomUUID().toString().replace("-","");
        context.getBean(FlowService.class).save(actor,"lab",flow,0,"schemaVersion: 1\nnamespace: lab\nid: "+flow+"\n"+tasks);
        return edge().submit(new Actor("gateway",Set.of("lab"),Set.of(Action.CONNECT)),"lab","pc",UUID.randomUUID().toString(),
                new FlowExecutionService.Request(flow,null,Map.of()));
    }
    private String terminalState(String name) throws Exception {
        var result=terminalEngine.execInContainer("docker","inspect","--format","{{.State.Status}}",name);
        return result.getExitCode()==0?result.getStdout().trim():"absent";
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
    @Test void resourceInventoryDoesNotTurnUnreachableKubernetesIntoEmptySuccess() throws Exception {
        int port;
        try(var socket=new java.net.ServerSocket(0)) { port=socket.getLocalPort(); }
        var config=json.map(Files.readString(kubeconfig));
        var first=(Map<String,Object>)((List<?>)config.get("clusters")).getFirst();
        ((Map<String,Object>)first.get("cluster")).put("server","http://127.0.0.1:"+port);
        var path=Files.createTempFile(kubeconfig.getParent(),"inventory-unreachable-",".json");
        try {
            Files.writeString(path,json.write(config));
            var connections=new com.project.platform.resource.kubernetes.KubernetesConnections(Map.of("lab",Map.of("edge",
                    new com.project.platform.resource.kubernetes.KubernetesConnections.Connection(path.toString(),"default","s4-test"))));
            var inventory=new com.project.platform.resource.kubernetes.KubernetesResourceService(resources(),connections);
            var failure=assertThrows(com.project.platform.resource.kubernetes.KubernetesResourceService.Unavailable.class,()->inventory.nodes(actor,"lab","edge",10,null));
            assertEquals("Kubernetes resource query failed; check cluster connection",failure.getMessage());
        } finally { Files.deleteIfExists(path); }
    }
    @Test void liveResourceInventoryUsesReadPermissionBoundedPagesAndConfiguredNamespace() throws Exception {
        var viewer=new Actor("viewer",Set.of("lab"),Set.of(Action.READ));
        var service=context.getBean(com.project.platform.resource.kubernetes.KubernetesResourceService.class);
        var nodes=service.nodes(viewer,"lab","edge",1,null);
        assertEquals("s4-test",nodes.namespace());assertEquals(1,nodes.items().size());
        assertFalse(nodes.items().getFirst().capacity().isEmpty());
        assertEquals("s4-test",service.namespace(viewer,"lab","edge").name());
        for(String name:List.of("inventory-a","inventory-b")) admin.services().inNamespace("s4-test").resource(
                new io.fabric8.kubernetes.api.model.ServiceBuilder().withNewMetadata().withName(name).endMetadata()
                .withNewSpec().addNewPort().withPort(80).withNewTargetPort(8080).endPort().endSpec().build()).create();
        try {
            var first=service.services(viewer,"lab","edge",1,null);
            assertEquals(1,first.items().size());assertNotNull(first.continueToken());assertFalse(first.continueToken().isBlank());
            assertEquals(List.of("80/TCP → 8080"),first.items().getFirst().ports());
            var second=service.services(viewer,"lab","edge",1,first.continueToken());
            assertEquals(1,second.items().size());assertNotEquals(first.items().getFirst().name(),second.items().getFirst().name());
            assertThrows(ResourceException.class,()->service.nodes(viewer,"lab","edge",0,null));
            assertThrows(com.project.platform.foundation.identity.AccessPolicy.Forbidden.class,()->service.nodes(viewer,"other","edge",10,null));
            assertThrows(ResourceException.class,()->service.services(viewer,"lab","missing",10,null));
            try(var restricted=context.getBean(com.project.platform.resource.kubernetes.KubernetesConnections.class).open("lab","edge")) {
                assertEquals(403,assertThrows(KubernetesClientException.class,()->restricted.namespaces().withName("default").get()).getCode());
                assertEquals(403,assertThrows(KubernetesClientException.class,()->restricted.services().inNamespace("default").list()).getCode());
                assertEquals(403,assertThrows(KubernetesClientException.class,()->restricted.services().inNamespace("s4-test").withName("inventory-a").delete()).getCode());
            }
            String base="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab/clusters/edge/kubernetes/";
            String auth="Basic "+Base64.getEncoder().encodeToString("viewer:test-api".getBytes(StandardCharsets.UTF_8));
            for(String endpoint:List.of("nodes","services","namespace")) {
                assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+endpoint)).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
                assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(base+endpoint)).header("Authorization",auth).build(),HttpResponse.BodyHandlers.discarding()).statusCode());
            }
        } finally { for(String name:List.of("inventory-a","inventory-b")) admin.services().inNamespace("s4-test").withName(name).delete(); }
    }
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
    @Test void repeatCarriesActualArtifactsAndWaitsForEvaluation() throws Exception {
        String id=submit("""
                tasks:
                  - id: rounds
                    type: core.Repeat
                    repeat:
                      iterations: {source: LITERAL, value: 2}
                      initial: {model: {source: LITERAL, value: 's3://datasets/sample/v1/data.txt'}}
                      feedback: {model: {source: TASK_OUTPUT, taskId: train, port: model.txt}}
                    tasks:
                      - id: train
                        type: platform.Application
                        timeout: PT60S
                        container:
                          applicationId: service
                          version: v1
                          candidateClusters: [edge]
                          command: [sh, -c, 'cat /cea-work/in/model > /cea-work/out/model.txt; printf "updated\\n" >> /cea-work/out/model.txt']
                          inputFiles: {model: {source: TASK_OUTPUT, taskId: rounds, port: model}}
                          outputFiles: [model.txt]
                      - id: evaluate
                        type: platform.Application
                        timeout: PT60S
                        container:
                          applicationId: service
                          version: v1
                          candidateClusters: [edge]
                          command: [sh, -c, 'sleep 1; wc -l < /cea-work/in/model > /cea-work/out/count.txt']
                          inputFiles: {model: {source: TASK_OUTPUT, taskId: train, port: model.txt}}
                          outputFiles: [count.txt]
                outputs: {model: {source: TASK_OUTPUT, taskId: rounds, port: model}}
                """);
        drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state(),executions().get(actor,"lab",id).error());
        String uri=executions().get(actor,"lab",id).outputs().get("model").toString();
        try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(uri).getPath().substring(1)).build())) {
            assertEquals("actual dataset bytes\nupdated\nupdated\n",new String(input.readAllBytes(),StandardCharsets.UTF_8));
        }
        var tasks=executions().tasks(actor,"lab",id);
        var train=tasks.stream().filter(t->t.taskId().equals("train")).toList();
        var evaluate=tasks.stream().filter(t->t.taskId().equals("evaluate")).toList();
        assertEquals(2,train.size());assertEquals(2,evaluate.size());
        assertNotEquals(train.get(0).outputs().get("model.txt"),train.get(1).outputs().get("model.txt"));
        assertFalse(train.get(1).startedAt().isBefore(evaluate.get(0).endedAt()));
        for(int i=0;i<2;i++)try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(evaluate.get(i).outputs().get("count.txt").toString()).getPath().substring(1)).build())) {
            assertEquals(Integer.toString(i+2),new String(input.readAllBytes(),StandardCharsets.UTF_8).trim());
        }
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
    @Test void gatewayApplicationUsesRealWorkerAndTerminalArtifactFeedsClusterTask() throws Exception {
        applications().register(actor,"lab","terminal-reader","v1",new ApplicationVersion("terminal-reader","v1","source:5000/alpine:v1",Map.of(
                "GREETING",new ApplicationVersion.Parameter(ApplicationVersion.ValueType.STRING,true,"hello",List.of(),null),
                "DATASET",new ApplicationVersion.Parameter(ApplicationVersion.ValueType.STRING,true,"sample/v1",List.of(),
                        new ApplicationVersion.DatasetRule("txt",List.of(new ApplicationVersion.DatasetRef("sample","v1")))))));
        primeTerminal("terminal-reader");
        String id=terminalSubmit("""
                tasks:
                  - id: local
                    type: platform.Application
                    timeout: PT60S
                    container:
                      applicationId: terminal-reader
                      version: v1
                      execution: TERMINAL
                      command: [sh, -c, 'cat "$DATASET_PATH" > /cea-work/out/result.txt; printf "%s\\n" "$GREETING" >> /cea-work/out/result.txt']
                      outputFiles: [result.txt]
                  - id: cluster
                    type: platform.Application
                    timeout: PT60S
                    container:
                      applicationId: service
                      version: v1
                      candidateClusters: [edge]
                      command: [sh, -c, 'cat /cea-work/in/data > /cea-work/out/final.txt; printf "edge\\n" >> /cea-work/out/final.txt']
                      inputFiles: {data: {source: TASK_OUTPUT, taskId: local, port: result.txt}}
                      outputFiles: [final.txt]
                outputs: {result: {source: TASK_OUTPUT, taskId: cluster, port: final.txt}}
                """);
        // Only this class's disposable MySQL: both execution paths must work without the offloading table.
        var db=context.getBean(JdbcTemplate.class);
        db.execute("RENAME TABLE off_task_observation TO off_task_observation_unavailable");
        try {drive(id);} finally {db.execute("RENAME TABLE off_task_observation_unavailable TO off_task_observation");}
        var execution=executions().get(actor,"lab",id);
        assertEquals(ExecutionState.SUCCESS,execution.state(),execution.error());
        assertEquals("actual dataset bytes\nhello\nedge\n",artifact(execution.outputs().get("result").toString()));
        var local=executions().tasks(actor,"lab",id).stream().filter(t->t.taskId().equals("local")).findFirst().orElseThrow();
        String name="cea-"+local.id()+"-a1";
        assertEquals("exited",terminalState(name));assertNull(admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get());
        assertEquals(0,context.getBean(JdbcTemplate.class).queryForObject("SELECT COUNT(*) FROM res_job_reservation WHERE allocation_id=?",Integer.class,local.id()+"-1"));
        assertEquals(1,executions().attempts(actor,"lab",id,local.id()).size());
    }
    @Test void terminalExecutionRejectsOrdinaryUserWithoutIngressReceipt() throws Exception {
        String id=submit(sleeper("PT30S","true").replace("candidateClusters: [edge]","execution: TERMINAL"));
        drive(id);assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());
        assertEquals("absent",terminalState(remoteName(id)));
    }
    @Test void terminalPreservesQuotedMultilineParametersWithoutHostShellInterpretation() throws Exception {
        String value="中文 'single' \"double\" \\path\n$(touch /cea-work/out/injected)\n";
        String source=sleeper("PT60S","printf \"%s\" \"$GREETING\" > /cea-work/out/value.txt; test ! -f /cea-work/out/injected")
                .replace("candidateClusters: [edge]","execution: TERMINAL")
                .replace("      command:","      parameters: {GREETING: {source: LITERAL, value: "+json.write(value)+"}}\n      outputFiles: [value.txt]\n      command:");
        String id=terminalSubmit(source);drive(id);
        var execution=executions().get(actor,"lab",id);assertEquals(ExecutionState.SUCCESS,execution.state(),execution.error());
        assertEquals(value,artifact(executions().tasks(actor,"lab",id).getFirst().outputs().get("value.txt").toString()));
    }
    @Test void terminalCommandExitAndMissingOutputAreRealFailures() throws Exception {
        for(boolean missing:List.of(false,true)) {
            String source=sleeper("PT60S",missing?"true":"exit 7").replace("candidateClusters: [edge]","execution: TERMINAL");
            if(missing)source=source.replace("      command:","      outputFiles: [missing.txt]\n      command:");
            else source=source.replace("    timeout:","    retry: {type: constant, maxAttempts: 2, interval: PT0.1S}\n    timeout:");
            String id=terminalSubmit(source);drive(id);
            var execution=executions().get(actor,"lab",id);assertEquals(ExecutionState.FAILED,execution.state(),execution.error());
            assertTrue(execution.error().contains(missing?"output file missing":"code 7"),execution.error());
            assertEquals("exited",terminalState(remoteName(id)));
            assertEquals(missing?1:2,executions().attempts(actor,"lab",id,executions().tasks(actor,"lab",id).getFirst().id()).size());
            assertEquals(0,context.getBean(com.project.platform.resource.placement.JobPlacementService.class).terminalLoad(actor,"lab","edge","pc",1).active());
            var run=executions().tasks(actor,"lab",id).getFirst();
            for(int attempt=1;attempt<=(missing?1:2);attempt++) {
                var sample=context.getBean(OffloadingService.class).get("lab",run.id()+"-"+attempt);
                assertNull(sample,"fixed terminal execution must not write offloading observations");
            }
        }
    }
    @Test void terminalWorkerTakeoverRetainsContainerAndDoesNotRepeatCommand() throws Exception {
        String source=sleeper("PT90S","printf x >> /cea-work/out/once.txt; sleep 5")
                .replace("candidateClusters: [edge]","execution: TERMINAL").replace("      command:","      outputFiles: [once.txt]\n      command:");
        String id=terminalSubmit(source);
        awaitDispatch(id);String name=remoteName(id);
        var local=new WorkerEngine(context.getBean(JdbcWorkerStore.class),new com.project.platform.runtime.definition.TemplateRenderer(),1000,context.getBean(TaskRunner.class));
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var running=pool.submit(local::runOnce);
            await().atMost(Duration.ofSeconds(40)).until(()->terminalEngine.execInContainer("docker","exec",name,"test","-f","/cea-work/out/once.txt").getExitCode()==0);
            String uid=terminalEngine.execInContainer("docker","inspect","--format","{{.Id}}",name).getStdout().trim();
            local.close();running.get(5,TimeUnit.SECONDS);
            var run=executions().tasks(actor,"lab",id).getFirst();
            context.getBean(JdbcTemplate.class).update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",run.id());
            drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state(),executions().get(actor,"lab",id).error());
            assertEquals(uid,terminalEngine.execInContainer("docker","inspect","--format","{{.Id}}",name).getStdout().trim());
            assertEquals("x",artifact(executions().tasks(actor,"lab",id).getFirst().outputs().get("once.txt").toString()));
            assertEquals(1,executions().attempts(actor,"lab",id,run.id()).size());
            var sample=context.getBean(OffloadingService.class).get("lab",run.id()+"-1");
            assertNull(sample,"terminal takeover must not require an offloading observation");
            assertEquals(0,context.getBean(com.project.platform.resource.placement.JobPlacementService.class).terminalLoad(actor,"lab","edge","pc",1).active());
        } finally {local.close();}
    }
    @Test void terminalCancellationStopsContainerBeforeFinally() throws Exception {
        String id=terminalSubmit(sleeper("PT90S","touch /cea-work/executing; sleep 60").replace("candidateClusters: [edge]","execution: TERMINAL"));
        awaitDispatch(id);String name=remoteName(id);
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var running=pool.submit(()->context.getBean(WorkerEngine.class).runOnce());
            await().atMost(Duration.ofSeconds(40)).until(()->terminalEngine.execInContainer("docker","exec",name,"test","-f","/cea-work/executing").getExitCode()==0);
            executions().cancel(actor,"lab",id);context.getBean(FlowExecutor.class).processNext();running.get(20,TimeUnit.SECONDS);
            drive(id);assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",id).state());
            assertEquals("exited",terminalState(name));
            assertEquals(ExecutionState.SUCCESS,executions().tasks(actor,"lab",id).stream().filter(t->t.taskId().equals("cleanup")).findFirst().orElseThrow().state());
        }
    }
    @Test void terminalTimeoutStopsRunningCommandAndRunsFinally() throws Exception {
        String id=terminalSubmit(sleeper("PT15S","sleep 60").replace("candidateClusters: [edge]","execution: TERMINAL"));
        drive(id);var execution=executions().get(actor,"lab",id);
        assertEquals(ExecutionState.FAILED,execution.state());assertTrue(execution.error().contains("timed out"),execution.error());
        assertEquals("exited",terminalState(remoteName(id)));
        assertEquals(ExecutionState.SUCCESS,executions().tasks(actor,"lab",id).stream().filter(t->t.taskId().equals("cleanup")).findFirst().orElseThrow().state());
    }
    private String artifact(String uri) throws Exception {
        try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(uri).getPath().substring(1)).build())) {
            return new String(input.readAllBytes(),StandardCharsets.UTF_8);
        }
    }
    @Test void offloadingRealThreeTargetsTrainRegisterAndExecuteDqn() throws Exception {
        prepareFederation();
        var decisions=context.getBean(OffloadingService.class);var slots=context.getBean(com.project.platform.resource.placement.JobPlacementService.class);
        var samples=new ArrayList<OffloadingService.Sample>();
        String command="printf offload > /cea-work/out/placement.txt";
        for(String target:List.of("TERMINAL","EDGE","CLOUD")) {
            String blocker="block"+UUID.randomUUID();
            try {
                if(!target.equals("TERMINAL"))assertTrue(slots.reserveTerminal(actor,"lab",blocker,"edge","pc",1));
                String candidate=target.equals("CLOUD")?"cloud":"edge";
                String source=sleeper("PT90S",command).replace("candidateClusters: [edge]","execution: TERMINAL\n      offload: {strategy: RULE, candidateClusters: ["+candidate+"]}")
                        .replace("      command:","      outputFiles: [placement.txt]\n      command:");
                String id=terminalSubmit(source);drive(id);var execution=executions().get(actor,"lab",id);
                assertEquals(ExecutionState.SUCCESS,execution.state(),execution.error());
                var run=executions().tasks(actor,"lab",id).stream().filter(t->t.taskId().equals("remote")).findFirst().orElseThrow();
                var sample=decisions.get("lab",run.id()+"-1");samples.add(sample);
                assertEquals(target,sample.target().kind());assertNotNull(sample.reward());
                assertEquals("offload",artifact(run.outputs().get("placement.txt").toString()));
                assertNotNull(decisions.estimate(actor,"lab",new OffloadingService.Workload("service","v1",List.of("sh","-c",command),Map.of("GREETING","hello"),0),sample.target()));
            } finally {slots.releaseTerminal("lab",blocker,"edge","pc");}
        }
        federation.copyFileToContainer(MountableFile.forHostPath(Path.of("..","algorithms","offloading","train.py")),"/tmp/offloading/train.py");
        federation.copyFileToContainer(MountableFile.forHostPath(Path.of("..","algorithms","offloading","test_training.py")),"/tmp/offloading/test_training.py");
        var unit=federation.execInContainer("python","/tmp/offloading/test_training.py");assertEquals(0,unit.getExitCode(),unit.getStderr());
        federation.copyFileToContainer(Transferable.of(json.write(samples)),"/tmp/offloading/samples.json");
        var trained=federation.execInContainer("python","/tmp/offloading/train.py","/tmp/offloading/samples.json","/tmp/offloading/model.json","--updates","300");
        assertEquals(0,trained.getExitCode(),trained.getStderr());
        var model=federation.copyFileFromContainer("/tmp/offloading/model.json",input->json.read(new String(input.readAllBytes(),StandardCharsets.UTF_8),DqnModel.class));
        String version="trained-"+UUID.randomUUID();decisions.register(actor,"lab",version,model);
        var reference=federation.execInContainer("python","-c","import json,torch; m=json.load(open('/tmp/offloading/model.json')); s=json.load(open('/tmp/offloading/samples.json'))[0]['state']; t=lambda x:torch.tensor(x,dtype=torch.float64); print(json.dumps((t(m['weights2'])@torch.relu(t(m['weights1'])@t(s)+t(m['bias1']))+t(m['bias2'])).tolist()))");
        assertEquals(0,reference.getExitCode(),reference.getStderr());assertArrayEquals(json.read(reference.getStdout(),double[].class),model.predict(samples.getFirst().state()),1e-9);
        String source=sleeper("PT90S",command).replace("candidateClusters: [edge]","execution: TERMINAL\n      offload: {strategy: DQN, modelVersion: "+version+", candidateClusters: [edge, cloud]}")
                .replace("      command:","      outputFiles: [placement.txt]\n      command:");
        String id=terminalSubmit(source);drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state(),executions().get(actor,"lab",id).error());
        var run=executions().tasks(actor,"lab",id).stream().filter(t->t.taskId().equals("remote")).findFirst().orElseThrow();
        var decision=decisions.get("lab",run.id()+"-1");assertEquals(version,decision.modelVersion());assertEquals(model.choose(decision.state()),decision.action());
        Path evidence=Path.of("target","offloading-evidence");Files.createDirectories(evidence);
        Files.writeString(evidence.resolve("training.txt"),trained.getStdout());Files.writeString(evidence.resolve("unit-tests.txt"),unit.getStdout()+unit.getStderr());
        Files.writeString(evidence.resolve("samples.json"),json.write(samples));Files.writeString(evidence.resolve("decision.json"),json.write(decision));
    }
    @Test void terminalQueueCancellationNeverStartsContainerOrLeaksSlot() throws Exception {
        var slots=context.getBean(com.project.platform.resource.placement.JobPlacementService.class);String blocker="wait"+UUID.randomUUID();
        assertTrue(slots.reserveTerminal(actor,"lab",blocker,"edge","pc",1));
        try {
            String id=terminalSubmit(sleeper("PT90S","true").replace("candidateClusters: [edge]","execution: TERMINAL"));awaitDispatch(id);
            try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
                var running=pool.submit(()->context.getBean(WorkerEngine.class).runOnce());
                await().atMost(Duration.ofSeconds(20)).until(()->slots.terminalLoad(actor,"lab","edge","pc",1).waiting()==1);
                assertEquals("absent",terminalState(remoteName(id)));executions().cancel(actor,"lab",id);context.getBean(FlowExecutor.class).processNext();running.get(10,TimeUnit.SECONDS);
                drive(id);assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",id).state());assertEquals(0,slots.terminalLoad(actor,"lab","edge","pc",1).waiting());
                var sample=context.getBean(OffloadingService.class).get("lab",executions().tasks(actor,"lab",id).getFirst().id()+"-1");
                assertNull(sample,"terminal FIFO cancellation is owned by resource, not offloading");
            }
        } finally {slots.releaseTerminal("lab",blocker,"edge","pc");}
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
        awaitDispatch(id);return id;
    }
    private void awaitDispatch(String id) {
        await().atMost(Duration.ofSeconds(5)).until(()->{
            context.getBean(FlowExecutor.class).processNext();
            return executions().tasks(actor,"lab",id).stream().anyMatch(t->t.state()==ExecutionState.RUNNING);
        });
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
    @Test void namespaceFileRevisionExecutesAndSurvivesWorkerTakeover() throws Exception {
        var files=context.getBean(com.project.platform.dataflow.definition.NamespaceFileService.class);
        String path="scripts/"+UUID.randomUUID()+".sh";
        files.save(actor,"lab",path,0,"sleep 4\nprintf original > /cea-work/out/result.txt\n");
        String yaml=sleeper("PT60S","sh /cea-work/in/work.sh")
                .replace("      command:","      namespaceFiles: {work.sh: {path: '"+path+"', revision: 1}}\n      outputFiles: [result.txt]\n      command:");
        String id=dispatch(yaml),name=remoteName(id);var run=executions().tasks(actor,"lab",id).getFirst();
        // Revision changes after submission cannot change the execution's explicitly pinned reference.
        files.save(actor,"lab",path,1,"printf wrong > /cea-work/out/result.txt\n");
        var local=new WorkerEngine(context.getBean(JdbcWorkerStore.class),new com.project.platform.runtime.definition.TemplateRenderer(),1000,context.getBean(TaskRunner.class));
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var running=pool.submit(local::runOnce);
            await().atMost(Duration.ofSeconds(30)).until(()->activePod(name));
            String uid=admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid();
            local.close();running.get(5,TimeUnit.SECONDS);
            context.getBean(JdbcTemplate.class).update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",run.id());
            drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
            assertEquals(uid,admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid());
            assertEquals(1,executions().attempts(actor,"lab",id,run.id()).size());
            String uri=executions().tasks(actor,"lab",id).getFirst().outputs().get("result.txt").toString();
            try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(uri).getPath().substring(1)).build())) {
                assertEquals("original",new String(input.readAllBytes(),StandardCharsets.UTF_8));
            }
        } finally {local.close();}
        String missing=submit(yaml.replace("revision: 1","revision: 999"));drive(missing);
        assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",missing).state());
        assertTrue(executions().get(actor,"lab",missing).error().contains("namespace file revision not found"));
        assertNull(admin.batch().v1().jobs().inNamespace("s4-test").withName(remoteName(missing)).get());
    }
    @Test void collectionManifestSurvivesWorkerTakeoverWithSameJobAndAttempt() throws Exception {
        String yaml=sleeper("PT60S","sleep 5; cat /cea-work/in/models.json > /cea-work/out/manifest.json; cat /cea-work/in/models.item-0 /cea-work/in/models.item-1 > /cea-work/out/data.txt")
                .replace("      command:","      inputFiles:\n        models: {source: LITERAL, value: ['s3://datasets/sample/v1/data.txt', 's3://datasets/sample/v1/data.txt']}\n      outputFiles: [manifest.json, data.txt]\n      command:");
        String id=dispatch(yaml),name=remoteName(id);
        var run=executions().tasks(actor,"lab",id).getFirst();
        var local=new WorkerEngine(context.getBean(JdbcWorkerStore.class),new com.project.platform.runtime.definition.TemplateRenderer(),1000,context.getBean(TaskRunner.class));
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var running=pool.submit(local::runOnce);
            await().atMost(Duration.ofSeconds(30)).until(()->activePod(name));
            String uid=admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid();
            String prepared=context.getBean(JdbcTemplate.class).queryForObject("SELECT prepared_json FROM wf_worker_job WHERE task_run_id=?",String.class,run.id());
            assertTrue(prepared.contains("models.json"));assertTrue(prepared.contains("models.item-1"));
            local.close();running.get(5,TimeUnit.SECONDS);
            context.getBean(JdbcTemplate.class).update("UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6)) WHERE task_run_id=?",run.id());
            drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state(),executions().get(actor,"lab",id).error());
            assertEquals(uid,admin.batch().v1().jobs().inNamespace("s4-test").withName(name).get().getMetadata().getUid());
            assertEquals(1,executions().attempts(actor,"lab",id,run.id()).size());
            var outputs=executions().tasks(actor,"lab",id).getFirst().outputs();
            for(String file:List.of("manifest.json","data.txt"))try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(outputs.get(file).toString()).getPath().substring(1)).build())) {
                String content=new String(input.readAllBytes(),StandardCharsets.UTF_8);
                if(file.equals("manifest.json"))assertEquals(List.of("/cea-work/in/models.item-0","/cea-work/in/models.item-1"),json.read(content,List.class));
                else assertEquals("actual dataset bytes\nactual dataset bytes\n",content);
            }
        } finally {local.close();}
    }
    @Test void loopCancellationStopsRemoteAndSlotWaitingItemsBeforeFinally() throws Exception {
        String id=submit("""
                tasks:
                  - id: each
                    type: core.Loop
                    loop: {values: {source: LITERAL, value: [a, b, c]}, concurrency: 2}
                    tasks:
                      - id: remote
                        type: platform.Application
                        timeout: PT60S
                        container:
                          applicationId: service
                          version: v1
                          candidateClusters: [edge]
                          command: [sh, -c, 'sleep 40']
                finally: [{id: cleanup, type: core.Log, message: cleaned}]
                """);
        await().atMost(Duration.ofSeconds(10)).until(()->{
            context.getBean(FlowExecutor.class).processNext();
            return executions().tasks(actor,"lab",id).stream().filter(r->r.taskId().equals("remote")).count()==2;
        });
        var children=executions().tasks(actor,"lab",id).stream().filter(r->r.taskId().equals("remote")).toList();
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var one=pool.submit(context.getBean(WorkerEngine.class)::runOnce);var two=pool.submit(context.getBean(WorkerEngine.class)::runOnce);
            await().atMost(Duration.ofSeconds(30)).until(()->children.stream().anyMatch(r->activePod("cea-"+r.id()+"-a1")));
            executions().cancel(actor,"lab",id);context.getBean(FlowExecutor.class).processNext();
            assertEquals(ExecutionState.KILLING,executions().get(actor,"lab",id).state());
            one.get(30,TimeUnit.SECONDS);two.get(30,TimeUnit.SECONDS);drive(id);
        }
        assertEquals(ExecutionState.KILLED,executions().get(actor,"lab",id).state());
        assertEquals(2,executions().tasks(actor,"lab",id).stream().filter(r->r.taskId().equals("remote")).count());
        assertTrue(children.stream().noneMatch(r->activePod("cea-"+r.id()+"-a1")));
        assertEquals(ExecutionState.SUCCESS,executions().tasks(actor,"lab",id).stream().filter(r->r.taskId().equals("cleanup")).findFirst().orElseThrow().state());
    }
    @Test void collectionFilesRejectInvalidUriTypeAndExpandedNameCollisionBeforeDispatch() throws Exception {
        for(String files:List.of("{source: LITERAL, value: [42]}","{source: LITERAL, value: ['https://invalid/data']}","{source: LITERAL, value: ['s3://datasets/sample.txt']}")) {
            String yaml=sleeper("PT60S","true").replace("      command:","      inputFiles:\n        models: "+files+"\n"+(files.contains("sample.txt")?"        models.json: {source: LITERAL, value: 's3://datasets/sample.txt'}\n":"")+"      command:");
            String id=submit(yaml);drive(id);
            assertEquals(ExecutionState.FAILED,executions().get(actor,"lab",id).state());
            assertNull(admin.batch().v1().jobs().inNamespace("s4-test").withName(remoteName(id)).get());
        }
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
    private void prepareFederation() throws Exception {
        if(federation!=null)return;
        Path evidence=Path.of("target","federated-evidence");Files.createDirectories(evidence);
        String image="cea-federated-test:"+UUID.randomUUID();
        // Always build current sources; Docker CLI uses the same BuildKit dependency cache as documented builds.
        var build=new ProcessBuilder("docker","build","--progress","plain","-t",image,
                Path.of("..","algorithms","federated").toString())
                .redirectErrorStream(true).redirectOutput(evidence.resolve("image-build.txt").toFile()).start();
        try {
            assertTrue(build.waitFor(10,TimeUnit.MINUTES),"federated image build must complete");
            assertEquals(0,build.exitValue(),Files.readString(evidence.resolve("image-build.txt")));
            federationImage=image;
        } finally {if(build.isAlive())build.destroyForcibly();}
        federation=new GenericContainer<>(DockerImageName.parse(image)).withCommand("sleep","infinity");federation.start();
        var numerical=federation.execInContainer("python","-m","unittest","-v","test_federated");
        assertEquals(0,numerical.getExitCode(),numerical.getStderr());
        Path rawCache=Path.of("target","federated-data","raw");Files.createDirectories(rawCache);
        var rawNames=List.of("train-images-idx3-ubyte.gz","train-labels-idx1-ubyte.gz","t10k-images-idx3-ubyte.gz","t10k-labels-idx1-ubyte.gz");
        for(String file:rawNames)if(Files.exists(rawCache.resolve(file)))
            federation.copyFileToContainer(MountableFile.forHostPath(rawCache.resolve(file)),"/tmp/mnist/raw/"+file);
        var seed=federation.execInContainer("python","seed.py","--output","/tmp/mnist","--train-samples","768","--test-samples","256");
        assertEquals(0,seed.getExitCode(),seed.getStderr());
        for(String file:rawNames)federation.copyFileFromContainer("/tmp/mnist/raw/"+file,rawCache.resolve(file).toString());
        Files.writeString(evidence.resolve("unit-tests.txt"),numerical.getStdout()+numerical.getStderr());
        federation.copyFileFromContainer("/tmp/mnist/manifest.json",evidence.resolve("dataset-manifest.json").toString());
        try(var client=s3()) {
            for(String file:List.of("edge-a.pt","edge-b.pt","edge-c.pt","test.pt")) {
                byte[] data=federation.copyFileFromContainer("/tmp/mnist/"+file,input->input.readAllBytes());
                client.putObject(io.minio.PutObjectArgs.builder().bucket("datasets").object("mnist/v1/"+file)
                        .stream(new java.io.ByteArrayInputStream(data),data.length,-1).build());
            }
        }
        Path archive=Files.createTempFile("cea-s5-federated-",".tar");
        try(var content=DockerClientFactory.instance().client().saveImageCmd(image).exec()) {
            Files.copy(content,archive,StandardCopyOption.REPLACE_EXISTING);
            tool.copyFileToContainer(MountableFile.forHostPath(archive),"/tmp/federated.tar");
        } finally {Files.deleteIfExists(archive);}
        var copied=tool.execInContainer("skopeo","--command-timeout=180s","copy","--dest-tls-verify=false",
                "--dest-authfile=/tmp/auth.json","docker-archive:/tmp/federated.tar","docker://source:5000/federated:v1");
        assertEquals(0,copied.getExitCode(),copied.getStderr());
        // Four catalog locations, one isolated K3s: tests locality/parallel Jobs, not physical multi-cloud.
        var args=new ArrayList<>(applicationArguments);
        args.remove("--platform.distribution.timeout=PT30S");args.add("--platform.distribution.timeout=PT3M");
        for(String cluster:List.of("cloud","edge-a","edge-b","edge-c")) {
            args.add("--platform.distribution.targets.lab."+cluster+"=target");
            args.add("--platform.kubernetes.connections.lab."+cluster+".kubeconfig="+kubeconfig);
            args.add("--platform.kubernetes.connections.lab."+cluster+".context=default");
            args.add("--platform.kubernetes.connections.lab."+cluster+".namespace=s4-test");
            args.add("--platform.jobs.slots.lab."+cluster+"=1");
        }
        context.close();applicationArguments=List.copyOf(args);
        context=new SpringApplicationBuilder(BackendApplication.class).run(args.toArray(String[]::new));
        for(String cluster:List.of("cloud","edge-a","edge-b","edge-c"))
            resources().putCluster(actor,"lab",cluster,new Cluster(cluster,cluster.equals("cloud")?Kind.CLOUD:Kind.EDGE,true));
        var registration=new ProcessBuilder("powershell","-NoProfile","-ExecutionPolicy","Bypass","-File",
                Path.of("..","scripts","register-federated.ps1").toString(),"-Image","source:5000/federated:v1",
                "-BaseUrl","http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port"));
        registration.environment().put("BACKEND_USER","writer");registration.environment().put("BACKEND_PASSWORD","test-api");
        var process=registration.redirectErrorStream(true).redirectOutput(evidence.resolve("registration.txt").toFile()).start();
        try {
            assertTrue(process.waitFor(60,TimeUnit.SECONDS),"registration script must complete");
            assertEquals(0,process.exitValue(),Files.readString(evidence.resolve("registration.txt")));
        } finally {if(process.isAlive())process.destroyForcibly();}
    }
    private void driveFederation(String id) throws Exception {
        try(var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var stop=new java.util.concurrent.atomic.AtomicBoolean();var workers=new ArrayList<Future<?>>();
            for(int i=0;i<3;i++)workers.add(pool.submit(()->{while(!stop.get()){context.getBean(WorkerEngine.class).runOnce();Thread.sleep(20);}return null;}));
            try {
                await().atMost(Duration.ofMinutes(6)).pollInterval(Duration.ofMillis(50)).until(()->{
                    context.getBean(FlowExecutor.class).processNext();return executions().get(actor,"lab",id).state().terminal();
                });
            } finally {
                stop.set(true);
                for(var worker:workers)try{worker.get(10,TimeUnit.SECONDS);}catch(TimeoutException ex){worker.cancel(true);}
            }
        }
    }
    @Test void jsonOutputIsBoundedAuthorizedPinnedAndNeverAcceptsForeignUris() throws Exception {
        String command="printf '{\"loss\":0.25,\"accuracy\":0.8,\"algorithm\":\"fixture\"}' > /cea-work/out/metrics.json; "
                +"printf '[]' > /cea-work/out/array.json; printf '{} {}' > /cea-work/out/trailing.json; "
                +"printf '{\"loss\":1,\"loss\":2}' > /cea-work/out/duplicate.json; printf '{\"loss\":1e400}' > /cea-work/out/invalid.json; "
                +"head -c 262145 /dev/zero > /cea-work/out/big.json";
        String id=submit("tasks:\n  - id: measure\n    type: platform.Application\n    timeout: PT60S\n    container:\n      applicationId: service\n      version: v1\n      candidateClusters: [edge]\n      command: "+json.write(List.of("sh","-c",command))+"\n      outputFiles: [metrics.json, array.json, trailing.json, duplicate.json, invalid.json, big.json]\n");
        var reader=context.getBean(com.project.platform.dataflow.execution.ExecutionOutputService.class);
        var run=executions().tasks(actor,"lab",id).getFirst();
        assertEquals(WorkflowException.Kind.CONFLICT,assertThrows(WorkflowException.class,()->reader.readJson(actor,"lab",id,run.id(),"metrics.json")).kind());
        drive(id);assertEquals(ExecutionState.SUCCESS,executions().get(actor,"lab",id).state());
        var value=reader.readJson(new Actor("viewer",Set.of("lab"),Set.of(Action.READ)),"lab",id,run.id(),"metrics.json");
        assertEquals(0.25,value.get("loss"));assertEquals(0.8,value.get("accuracy"));
        assertThrows(Forbidden.class,()->reader.readJson(new Actor("foreign",Set.of("other"),Set.of(Action.READ)),"lab",id,run.id(),"metrics.json"));
        assertEquals(WorkflowException.Kind.NOT_FOUND,assertThrows(WorkflowException.class,()->reader.readJson(actor,"lab",id,"foreign-task","metrics.json")).kind());
        for(String port:List.of("array.json","trailing.json","duplicate.json","invalid.json","../metrics.json","model.pt","unknown.json"))
            assertThrows(WorkflowException.class,()->reader.readJson(actor,"lab",id,run.id(),port),port);
        assertThrows(ResourceException.class,()->reader.readJson(actor,"lab",id,run.id(),"big.json"));
        var objectStorage=context.getBean(com.project.platform.resource.storage.ObjectStorage.class);
        for(String uri:List.of("http://localhost/metrics.json","s3://datasets/metrics.json","s3://artifacts/other/metrics.json","s3://artifacts/lab/other/"+run.id()+"/1/metrics.json","s3://artifacts/lab/"+id+"/"+run.id()+"/2/metrics.json"))
            assertThrows(ResourceException.class,()->objectStorage.readPublished("lab",id,run.id(),1,"metrics.json",uri,262144));
        String base="http://127.0.0.1:"+context.getEnvironment().getProperty("local.server.port")+"/api/namespaces/lab/executions/"+id+"/tasks/"+run.id()+"/output-json?port=metrics.json";
        var request=HttpRequest.newBuilder(URI.create(base));
        assertEquals(401,http.send(request.GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode());
        request.header("Authorization","Basic "+Base64.getEncoder().encodeToString("writer:test-api".getBytes(StandardCharsets.UTF_8)));
        var response=http.send(request.GET().build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(200,response.statusCode(),response.body());assertEquals(value,json.map(response.body()));
        var execution=executions().get(actor,"lab",id);
        context.getBean(FlowService.class).save(actor,"lab",execution.flowId(),1,"schemaVersion: 1\nnamespace: lab\nid: "+execution.flowId()+"\ntasks: [{id: newer, type: core.Log, message: changed}]");
        assertEquals(value,reader.readJson(actor,"lab",id,run.id(),"metrics.json"));
        try(var client=s3()) {client.removeObject(io.minio.RemoveObjectArgs.builder().bucket("artifacts").object("lab/"+id+"/"+run.id()+"/1/metrics.json").build());}
        assertEquals(404,http.send(request.GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode());
    }
    @Test void fedAvgMigratesThroughActualTrainingAggregationAndEvaluation() throws Exception {verifyFederation("fedavg");}
    @Test void fedProxMigratesThroughActualTrainingAggregationAndEvaluation() throws Exception {verifyFederation("fedprox");}
    private void verifyFederation(String algorithm) throws Exception {
        prepareFederation();
        var letters=algorithm.equals("fedavg")?List.of("a","b","c"):List.of("a","c");
        var flows=context.getBean(FlowService.class);
        var saved=flows.get(actor,"lab",algorithm,null);
        assertFalse(saved.definition().inputs().containsKey("clients"));
        assertInstanceOf(com.project.platform.runtime.model.FlowDefinition.Literal.class,saved.definition().tasks().get(1).tasks().getFirst().loop().values());
        if(algorithm.equals("fedprox")) {
            // Client membership is edited in the Loop definition, not passed as an execution input.
            String source=saved.source().replace("\r\n","\n").replace("              - {id: edge-b, clusters: [edge-b]}\n", "");
            assertNotEquals(saved.source().replace("\r\n","\n"),source);
            flows.save(actor,"lab",algorithm,saved.revision(),source);
        }
        String id=executions().submit(actor,"lab",UUID.randomUUID().toString(),new FlowExecutionService.Request(algorithm,null,Map.of()));
        driveFederation(id);
        var execution=executions().get(actor,"lab",id);
        assertEquals(ExecutionState.SUCCESS,execution.state(),execution.error());
        assertEquals(2,((Number)execution.outputs().get("completed_rounds")).intValue());
        var runs=executions().tasks(actor,"lab",id);
        var leaves=runs.stream().filter(r->execution.definition().allTasks().stream().anyMatch(t->t.id().equals(r.taskId())&&t.container()!=null)).toList();
        int expectedLeaves=1+2*(letters.size()+2);
        assertEquals(expectedLeaves,leaves.size());assertEquals(expectedLeaves,leaves.stream().map(r->r.id()).distinct().count());
        Path evidence=Path.of("target","federated-evidence",algorithm);Files.createDirectories(evidence);
        for(var run:leaves) {
            assertEquals(1,executions().attempts(actor,"lab",id,run.id()).size());
            var parent=runs.stream().filter(r->r.id().equals(run.parentTaskRunId())).findFirst();
            int round=run.taskId().equals("train")?parent.orElseThrow().iteration():run.iteration();
            String task=run.taskId().equals("train")?"client-"+letters.get(run.iteration()-1):run.taskId();
            String file=task.equals("init")?"init.pt":task+"-r"+round+(task.equals("evaluate")?".json":".pt");
            String uri=run.outputs().values().iterator().next().toString();
            try(var client=s3();var input=client.getObject(io.minio.GetObjectArgs.builder().bucket("artifacts").object(URI.create(uri).getPath().substring(1)).build())) {
                byte[] content=input.readAllBytes();Files.write(evidence.resolve(file),content);
                federation.copyFileToContainer(Transferable.of(content),"/tmp/audit/"+algorithm+"/"+file);
            }
            String cluster=run.taskId().equals("train")?"edge-"+letters.get(run.iteration()-1):"cloud";
            assertEquals(cluster,context.getBean(JdbcTemplate.class).queryForObject(
                    "SELECT cluster_id FROM res_job_reservation WHERE namespace='lab' AND allocation_id=?",String.class,run.id()+"-1"));
            var podSpec=admin.batch().v1().jobs().inNamespace("s4-test").withName("cea-"+run.id()+"-a1").get().getSpec().getTemplate().getSpec();
            var environment=podSpec.getContainers().getFirst().getEnv().stream().collect(java.util.stream.Collectors.toMap(e->e.getName(),e->e.getValue()));
            if(run.taskId().equals("train")) {
                assertEquals(cluster,environment.get("CLIENT_ID"));
                assertEquals("/cea-work/in/dataset-DATASET",environment.get("DATASET_PATH"));
            } else if(run.taskId().equals("evaluate")) {
                assertEquals("/cea-work/in/dataset-TEST_DATASET",environment.get("TEST_DATASET_PATH"));
            }
        }
        for(int round=1;round<=2;round++) {
            final int n=round;
            var loop=runs.stream().filter(r->r.taskId().equals("clients")&&r.iteration()==n).findFirst().orElseThrow();
            var clients=runs.stream().filter(r->r.taskId().equals("train")&&r.parentTaskRunId().equals(loop.id())).sorted(Comparator.comparingInt(r->r.iteration())).toList();
            assertEquals(letters.size(),clients.size());
            assertEquals(clients.stream().map(r->r.outputs().get("model.pt")).toList(),loop.outputs().get("models"));
            var aggregate=runs.stream().filter(r->r.taskId().equals("aggregate")&&r.iteration()==n).findFirst().orElseThrow();
            var evaluate=runs.stream().filter(r->r.taskId().equals("evaluate")&&r.iteration()==n).findFirst().orElseThrow();
            var metrics=context.getBean(com.project.platform.dataflow.execution.ExecutionOutputService.class).readJson(actor,"lab",id,evaluate.id(),"metrics.json");
            assertEquals(n,((Number)metrics.get("round")).intValue());assertEquals(algorithm,metrics.get("algorithm"));
            assertEquals(json.map(Files.readString(evidence.resolve("evaluate-r"+n+".json"))),metrics);
            assertTrue(Double.isFinite(((Number)metrics.get("loss")).doubleValue()));
            assertTrue(clients.stream().allMatch(r->!aggregate.startedAt().isBefore(r.endedAt())));
            assertFalse(evaluate.startedAt().isBefore(aggregate.endedAt()));
            var latestStart=clients.stream().map(r->r.startedAt()).max(Comparator.naturalOrder()).orElseThrow();
            var earliestEnd=clients.stream().map(r->r.endedAt()).min(Comparator.naturalOrder()).orElseThrow();
            assertTrue(latestStart.isBefore(earliestEnd),"dynamic client TaskRuns overlap");
            if(n==2) {
                var prior=runs.stream().filter(r->r.taskId().equals("evaluate")&&r.iteration()==1).findFirst().orElseThrow();
                assertTrue(clients.stream().allMatch(r->!r.startedAt().isBefore(prior.endedAt())));
            }
        }
        for(String file:List.of("edge-a.pt","edge-b.pt","edge-c.pt","test.pt")) {
            byte[] data=federation.copyFileFromContainer("/tmp/mnist/"+file,input->input.readAllBytes());
            federation.copyFileToContainer(Transferable.of(data),"/tmp/audit/"+algorithm+"/"+file);
        }
        var auditArgs=new ArrayList<>(List.of("python","verify_run.py","/tmp/audit/"+algorithm,algorithm,"--clients"));auditArgs.addAll(letters);
        var audit=federation.execInContainer(auditArgs.toArray(String[]::new));
        Files.writeString(evidence.resolve("numerical-audit.json"),audit.getStdout());
        assertEquals(0,audit.getExitCode(),audit.getStderr());
        assertEquals("PASS",json.map(audit.getStdout().trim()).get("numericalAudit"));
        Files.writeString(evidence.resolve("execution.json"),json.write(execution));
        Files.writeString(evidence.resolve("task-runs.json"),json.write(runs));
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

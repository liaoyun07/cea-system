package com.project.platform.runtime.worker;

import com.project.platform.runtime.worker.ContainerTask.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Docker context is deployment configuration, never a value supplied by the task author. */
public final class DockerTaskRunner {
    private record Reply(int code,String text) {}
    public boolean available(TaskContext context,String dockerContext) throws Exception {
        try {return command(context,List.of("docker","--context",dockerContext),List.of("info","--format","{{.ServerVersion}}")).code()==0;}
        catch(IOException unavailable){return false;}
    }
    public WorkerJob.Result run(TaskContext task,String dockerContext,Spec spec,Filesystem files) throws Exception {
        String name=ContainerTask.name(task.job());
        var docker=new ArrayList<>(List.of("docker","--context",dockerContext));
        task.check();
        if(required(task,docker,"container","ls","-a","--filter","name=^/"+name+"$","--format","{{.Names}}").isBlank()) {
            if(task.cancellation()!=null)return WorkerJob.Result.failed(task.cancellation());
            var create=new ArrayList<>(List.of("create","--name",name,"--label","com.project.cea.attempt="+name,
                    "--network","none","--cap-drop","ALL","--security-opt","no-new-privileges",
                    "--workdir","/cea-work","--entrypoint","/bin/sh"));
            create.add(spec.image());create.addAll(List.of("-c",
                    "while [ ! -f /cea-work/ready ]; do sleep 0.2; done; exec /bin/sh /cea-work/run"));
            var reply=command(task,docker,create);
            // Another lease owner may have created the same deterministic attempt while this call was in flight.
            if(reply.code()!=0 && required(task,docker,"container","ls","-a","--filter","name=^/"+name+"$","--format","{{.Names}}").isBlank())
                throw new IOException("Docker container create failed");
        }
        if(!name.equals(required(task,docker,"container","ls","-a","--filter","name=^/"+name+"$",
                "--filter","label=com.project.cea.attempt="+name,"--format","{{.Names}}").trim()))
            throw new IOException("Docker attempt ownership mismatch");
        while(true) {
            task.check();
            String state=required(task,docker,"inspect","--format","{{.State.Status}}",name).trim();
            if(task.cancellation()!=null) {
                if("running".equals(state) || "restarting".equals(state) || "paused".equals(state))
                    required(task,docker,"stop","--time","5",name);
                return WorkerJob.Result.failed(task.cancellation());
            }
            if("created".equals(state)) {required(task,docker,"start",name);continue;}
            if("exited".equals(state)) {
                String code=required(task,docker,"inspect","--format","{{.State.ExitCode}}",name).trim();
                if(!"0".equals(code))return WorkerJob.Result.failed("Docker command exited with code "+code);
                var result=new LinkedHashMap<String,Object>();
                for(String output:spec.outputs())result.put(output,files.published(output));
                return WorkerJob.Result.success(result);
            }
            if(!"running".equals(state))throw new IOException("Docker attempt is not running: "+state);
            if(!exists(task,docker,name,"start")) {
                required(task,docker,"exec",name,"mkdir","-p","/cea-work/in","/cea-work/out");
                if(!exists(task,docker,name,"ready")) {
                    // Transfer the script as UTF-8, not host CLI arguments: preserve quotes/newlines on Windows and Unix.
                    var script=new StringBuilder();
                    spec.environment().forEach((key,value)->script.append("export ").append(quote(key+"="+value)).append('\n'));
                    script.append("set --");spec.command().forEach(arg->script.append(' ').append(quote(arg)));
                    script.append('\n').append(ContainerTask.WRAPPER);
                    Path temp=Files.createTempFile("cea-docker-script-",".sh");
                    try {Files.writeString(temp,script);required(task,docker,"cp",temp.toString(),name+":/cea-work/run.tmp");}
                    finally {Files.deleteIfExists(temp);}
                    required(task,docker,"exec",name,"mv","/cea-work/run.tmp","/cea-work/run");
                    required(task,docker,"exec",name,"touch","/cea-work/ready");
                }
                for(String input:spec.inputs()) {
                    Path temp=Files.createTempFile("cea-docker-in-",".bin");
                    try {files.download(input,temp);required(task,docker,"cp",temp.toString(),name+":/cea-work/in/"+input);}
                    finally {Files.deleteIfExists(temp);}
                }
                task.check();if(task.cancellation()!=null)continue;
                required(task,docker,"exec",name,"touch","/cea-work/start");
            }
            if(exists(task,docker,name,"exit")) {
                String code=required(task,docker,"exec",name,"cat","/cea-work/exit").trim();
                if("0".equals(code))for(String output:spec.outputs()) {
                    if(!exists(task,docker,name,"out/"+output)) {
                        task.stop("required output file missing: "+output);break;
                    }
                    Path temp=Files.createTempFile("cea-docker-out-",".bin");
                    try {required(task,docker,"cp","-L",name+":/cea-work/out/"+output,temp.toString());files.publish(output,temp);}
                    finally {Files.deleteIfExists(temp);}
                }
                task.check();if(task.cancellation()!=null)continue;
                required(task,docker,"exec",name,"touch","/cea-work/published");
            }
            Thread.sleep(200);
        }
    }
    private static String quote(String value) {return "'"+value.replace("'","'\"'\"'")+"'";}
    private boolean exists(TaskContext task,List<String> docker,String name,String file) throws Exception {
        var reply=command(task,docker,List.of("exec",name,"test","-f","/cea-work/"+file));
        if(reply.code()>1)throw new IOException("Docker file probe failed");
        return reply.code()==0;
    }
    private String required(TaskContext task,List<String> docker,String... arguments) throws Exception {
        var reply=command(task,docker,List.of(arguments));
        if(reply.code()!=0) {
            System.getLogger(DockerTaskRunner.class.getName()).log(System.Logger.Level.WARNING,
                    "Docker {0} failed with exit code {1}",arguments[0],reply.code());
            throw new IOException("Docker "+arguments[0]+" failed");
        }
        return reply.text();
    }
    private Reply command(TaskContext task,List<String> docker,List<String> arguments) throws Exception {
        task.check();var command=new ArrayList<>(docker);command.addAll(arguments);
        Path output=Files.createTempFile("cea-docker-command-",".log");Process process=null;
        try {
            process=new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(output.toFile()).start();
            long deadline=System.nanoTime()+TimeUnit.MINUTES.toNanos(2);
            while(!process.waitFor(200,TimeUnit.MILLISECONDS)) {
                task.check();if(System.nanoTime()>deadline)throw new IOException("Docker command timed out; outcome unknown");
            }
            task.check();
            try(var input=Files.newInputStream(output)) {return new Reply(process.exitValue(),new String(input.readNBytes(65536),java.nio.charset.StandardCharsets.UTF_8));}
        } finally {
            try {if(process!=null && process.isAlive()){process.destroyForcibly();process.waitFor(5,TimeUnit.SECONDS);}}
            finally {Files.deleteIfExists(output);}
        }
    }
}

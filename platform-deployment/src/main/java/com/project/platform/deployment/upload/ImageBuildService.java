package com.project.platform.deployment.upload;

import com.project.platform.deployment.application.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipInputStream;

/** Bounded Dockerfile build using an administrator-configured BuildKit client; shares the existing import path. */
public final class ImageBuildService {
    public record Result(ApplicationVersion application,String log) {}
    public static final long MAX_SOURCE=100L*1024*1024,MAX_EXPANDED=512L*1024*1024,MAX_IMAGE=2L*1024*1024*1024;
    private final AccessPolicy access;
    private final ApplicationCatalogService applications;
    private final ImageUploadService uploads;
    private final List<String> command;
    private final Path directory;
    private final Duration timeout;
    private final Semaphore permit=new Semaphore(1);
    public ImageBuildService(AccessPolicy access,ApplicationCatalogService applications,ImageUploadService uploads,List<String> command,Path directory,Duration timeout) {
        if(command==null || command.isEmpty() || directory==null || timeout==null || timeout.isNegative() || timeout.isZero() || timeout.compareTo(Duration.ofMinutes(20))>0)
            throw new IllegalArgumentException("BuildKit command, directory and bounded timeout required");
        this.access=access;this.applications=applications;this.uploads=uploads;this.command=List.copyOf(command);this.directory=directory.toAbsolutePath().normalize();this.timeout=timeout;
    }
    public Result build(Actor actor,String namespace,String application,String version,ImageUploadService.Request contract,long size,InputStream source) {
        access.require(actor,namespace,Action.WRITE);
        if(size<1 || size>MAX_SOURCE || contract==null)throw ApplicationException.invalid("source ZIP must contain 1..100 MiB; contract required");
        if(!namespace.matches("[a-z][a-z0-9.-]*") || application==null || !application.matches("[a-z][a-z0-9.-]*"))
            throw ApplicationException.invalid("build requires lowercase OCI-compatible namespace/application id");
        applications.validateNew(actor,namespace,application,version,new ApplicationVersion(application,version,"cea-build.local/"+namespace+"/"+application+":build",contract.parameters()));
        if(!permit.tryAcquire())throw ApplicationException.conflict("another image build is active; retry after it finishes");
        Path work=null;
        try {
            Files.createDirectories(directory);work=Files.createTempDirectory(directory,"cea-build-");
            Path context=Files.createDirectory(work.resolve("context")),archive=work.resolve("image.tar");
            extract(source,context);
            if(!Files.isRegularFile(context.resolve("Dockerfile")))throw ApplicationException.invalid("ZIP requires Dockerfile at its root");
            var args=new ArrayList<>(command);
            args.addAll(List.of("build","--frontend","dockerfile.v0","--local","context="+context,"--local","dockerfile="+context,
                    "--opt","platform=linux/amd64","--output","type=docker,name=cea-build.local/result:build,dest="+archive,"--progress","plain"));
            String log=execute(args,archive);
            if(!Files.isRegularFile(archive) || Files.size(archive)==0 || Files.size(archive)>MAX_IMAGE)throw ApplicationException.invalid("built image must contain 1 byte..2 GiB");
            try(var input=Files.newInputStream(archive)) {
                return new Result(uploads.upload(actor,namespace,application,version,contract,Files.size(archive),input),log);
            }
        } catch(InvalidPathException ex) { throw ApplicationException.invalid("ZIP contains invalid path characters"); }
        catch(IOException ex) { throw ApplicationException.invalid("build staging/client failed; check configured builder and storage: "+ex.getClass().getSimpleName()); }
        finally {
            if(work!=null)cleanup(work);
            permit.release();
        }
    }
    private void extract(InputStream source,Path root) throws IOException {
        long expanded=0;int count=0;var seen=new HashSet<Path>();
        // JDK ZIP reads content only: never restore symlinks, hardlinks or host file permissions.
        try(var zip=new ZipInputStream(new FilterInputStream(source) {
            long bytes;
            @Override public int read(byte[] b,int off,int len)throws IOException {int n=in.read(b,off,len);if(n>0 && (bytes+=n)>MAX_SOURCE)throw new IOException("compressed source limit");return n;}
            @Override public int read()throws IOException {int n=in.read();if(n>=0 && ++bytes>MAX_SOURCE)throw new IOException("compressed source limit");return n;}
        })) {
            java.util.zip.ZipEntry entry;byte[] buffer=new byte[65536];
            while((entry=zip.getNextEntry())!=null) {
                String name=entry.getName();
                if(++count>10000 || name.length()>500 || name.contains("\\") || name.contains(":") || name.startsWith("/") || Arrays.asList(name.split("/")).contains(".."))
                    throw ApplicationException.invalid("ZIP contains invalid paths or too many files");
                Path target=root.resolve(name).normalize();
                if(!target.startsWith(root) || target.equals(root) || !seen.add(target))throw ApplicationException.invalid("duplicate or invalid ZIP entry");
                if(entry.isDirectory()){Files.createDirectories(target);continue;}
                Files.createDirectories(target.getParent());
                try(var output=Files.newOutputStream(target,StandardOpenOption.CREATE_NEW)) {
                    int read;while((read=zip.read(buffer))!=-1) {
                        expanded+=read;if(expanded>MAX_EXPANDED)throw ApplicationException.invalid("expanded build context exceeds 512 MiB");
                        output.write(buffer,0,read);
                    }
                }
            }
        }
    }
    private String execute(List<String> args,Path archive)throws IOException {
        Process process=new ProcessBuilder(args).redirectErrorStream(true).start();
        StringBuffer log=new StringBuffer();
        Thread reader=Thread.ofVirtual().start(()->{
            try(var stream=new InputStreamReader(process.getInputStream(),StandardCharsets.UTF_8)) {
                char[] b=new char[4096];int n;
                while((n=stream.read(b))!=-1)synchronized(log){log.append(b,0,n);if(log.length()>65536)log.delete(0,log.length()-65536);}
            } catch(IOException ignored) { /* process cancellation closes the stream */ }
        });
        try {
            long deadline=System.nanoTime()+timeout.toNanos();
            while(!process.waitFor(250,TimeUnit.MILLISECONDS)) {
                if(System.nanoTime()>deadline)throw ApplicationException.invalid("image build timed out");
                if(Files.exists(archive) && Files.size(archive)>MAX_IMAGE)throw ApplicationException.invalid("built image exceeds 2 GiB");
            }
            reader.join(2000);
            if(process.exitValue()!=0) {
                String tail=log.toString();throw ApplicationException.invalid("image build failed: "+tail.substring(Math.max(0,tail.length()-4000)));
            }
            return log.toString();
        } catch(InterruptedException ex) {Thread.currentThread().interrupt();throw ApplicationException.invalid("image build interrupted; no application registered");}
        finally {
            if(process.isAlive()){
                process.descendants().forEach(ProcessHandle::destroyForcibly);process.destroyForcibly();
                try{process.waitFor(5,TimeUnit.SECONDS);}catch(InterruptedException ex){Thread.currentThread().interrupt();}
            }
            try{process.getInputStream().close();}catch(IOException ignored){}
        }
    }
    private void cleanup(Path work) {
        if(!work.getParent().equals(directory) || !work.getFileName().toString().startsWith("cea-build-"))throw new IllegalStateException("unexpected build cleanup path");
        try(var paths=Files.walk(work)) {for(Path path:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}
        catch(IOException ex){System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING,"Build temporary files require cleanup in configured staging directory");}
    }
}

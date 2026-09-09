package com.project.platform.deployment.distribution;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

/** Registry protocol/authentication is delegated to Skopeo, not reimplemented here. */
public final class SkopeoImageClient {
    public record Registry(String address, boolean tlsVerify, String authFile) {}
    public static final class Failure extends RuntimeException {
        public Failure(String message) { super(message); }
    }
    private final List<String> command;
    private final Duration timeout;

    public SkopeoImageClient(List<String> command, Duration timeout) {
        if(command==null || command.isEmpty() || timeout==null || timeout.compareTo(Duration.ofSeconds(1))<0
                || timeout.compareTo(Duration.ofMinutes(15))>0) throw new IllegalArgumentException("invalid Skopeo command/timeout");
        this.command=List.copyOf(command);this.timeout=timeout;
    }
    public String digest(String image, Registry registry) {
        var args=new ArrayList<>(List.of("inspect","--no-tags","--format","{{.Digest}}","--tls-verify="+registry.tlsVerify()));
        if(registry.authFile()!=null) args.addAll(List.of("--authfile",registry.authFile()));
        args.add("docker://"+image);
        String digest=run(args).trim();
        if(!digest.matches("sha256:[a-f0-9]{64}")) throw new Failure("Registry returned an unsupported image digest");
        return digest;
    }
    public void copy(String source, Registry from, String target, Registry to) {
        var args=new ArrayList<>(List.of("copy","--all","--preserve-digests","--quiet",
                "--src-tls-verify="+from.tlsVerify(),"--dest-tls-verify="+to.tlsVerify()));
        if(from.authFile()!=null) args.addAll(List.of("--src-authfile",from.authFile()));
        if(to.authFile()!=null) args.addAll(List.of("--dest-authfile",to.authFile()));
        args.addAll(List.of("docker://"+source,"docker://"+target));run(args);
    }
    private String run(List<String> args) {
        var invocation=new ArrayList<>(command);
        invocation.add("--command-timeout="+timeout.toSeconds()+"s");invocation.addAll(args);
        Process process;
        try { process=new ProcessBuilder(invocation).redirectError(ProcessBuilder.Redirect.DISCARD).start(); }
        catch(IOException ex) { throw new Failure("Cannot start configured Skopeo executable"); }
        try(var reader=Executors.newVirtualThreadPerTaskExecutor()) {
            var output=reader.submit(()->{
                try(var input=process.getInputStream()) {
                    byte[] prefix=input.readNBytes(65537);
                    input.transferTo(java.io.OutputStream.nullOutputStream());
                    if(prefix.length>65536) throw new Failure("Skopeo response exceeds 64 KiB");
                    return new String(prefix,StandardCharsets.UTF_8);
                }
            });
            try {
                if(!process.waitFor(timeout.toMillis()+2000,TimeUnit.MILLISECONDS)) throw new Failure("Skopeo operation timed out");
                if(process.exitValue()!=0) throw new Failure("Skopeo "+args.getFirst()+" failed (exit "+process.exitValue()+"); check registry connectivity, image and configured credentials");
                return output.get(2,TimeUnit.SECONDS);
            } catch(InterruptedException ex) {
                Thread.currentThread().interrupt();throw new Failure("Skopeo operation interrupted; preparation is not confirmed");
            } catch(ExecutionException | TimeoutException ex) { throw new Failure("Cannot read Skopeo result"); }
            finally { if(process.isAlive()) process.destroyForcibly(); }
        }
    }
}

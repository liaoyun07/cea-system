package com.project.platform.deployment.distribution;

import com.project.platform.deployment.application.ApplicationException;
import com.project.platform.foundation.identity.AccessPolicy.Actor;
import java.io.IOException;
import java.nio.file.*;
import java.util.Map;
import java.util.concurrent.Semaphore;

/** Owns temporary archive lifetime, not image catalog or workflow state. */
public final class ImageDownloadService {
    private final RegistryManagementService management;
    private final SkopeoImageClient images;
    private final Map<String,SkopeoImageClient.Registry> registries;
    private final Path directory;
    private final Semaphore permits;
    public ImageDownloadService(RegistryManagementService management,SkopeoImageClient images,
            Map<String,SkopeoImageClient.Registry> registries,Path directory,int concurrency) {
        this.management=management;this.images=images;this.registries=Map.copyOf(registries);
        this.directory=directory;this.permits=new Semaphore(concurrency);
    }
    public final class Download implements AutoCloseable {
        private final Path folder;
        private final String filename;
        private Download(Path folder,String filename) {this.folder=folder;this.filename=filename;}
        public Path archive() {return folder.resolve("image.tar");}
        public String filename() {return filename;}
        @Override public void close() {
            try {cleanup(folder);} finally {permits.release();}
        }
    }
    public Download prepare(Actor actor,String namespace,String registry,String repository,String digest) {
        boolean index=management.requireDownload(actor,namespace,registry,repository,digest);
        if(!permits.tryAcquire())throw ApplicationException.conflict("image download capacity is busy; retry after the active download finishes");
        Path folder=null;
        try {
            Files.createDirectories(directory);folder=Files.createTempDirectory(directory,"download-");
            String shortDigest=digest.substring(7,19);
            var download=new Download(folder,repository.replace('/','-')+"-"+shortDigest+(index?".oci.tar":".tar"));
            var source=registries.get(registry);
            images.exportArchive(source.address()+"/"+repository+"@"+digest,source,download.archive(),repository+":sha256-"+shortDigest,index);
            return download;
        } catch(IOException | RuntimeException ex) {
            try {if(folder!=null)cleanup(folder);} finally {permits.release();}
            if(ex instanceof RuntimeException runtime)throw runtime;
            throw new SkopeoImageClient.Failure("Cannot stage image download; check archive storage and available space");
        }
    }
    private static void cleanup(Path folder) {
        try {Files.deleteIfExists(folder.resolve("image.tar"));Files.deleteIfExists(folder);}
        catch(IOException ex) {System.getLogger(ImageDownloadService.class.getName()).log(System.Logger.Level.WARNING,"Image download temporary file cleanup failed; inspect configured upload directory");}
    }
}

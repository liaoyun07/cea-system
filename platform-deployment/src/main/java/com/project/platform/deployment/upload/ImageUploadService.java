package com.project.platform.deployment.upload;

import com.project.platform.deployment.application.*;
import com.project.platform.deployment.distribution.SkopeoImageClient;
import com.project.platform.deployment.distribution.SkopeoImageClient.Registry;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.Semaphore;

/** Bounded archive import followed by the existing immutable catalog registration. No image execution. */
public final class ImageUploadService {
    public record Request(Map<String,ApplicationVersion.Parameter> parameters) {}
    private final AccessPolicy access;
    private final ApplicationCatalogService applications;
    private final SkopeoImageClient images;
    private final Map<String,Registry> centers;
    private final Path directory;
    private final long maxBytes;
    private final Semaphore permits;
    public ImageUploadService(AccessPolicy access,ApplicationCatalogService applications,SkopeoImageClient images,
                              Map<String,Registry> centers,Path directory,long maxBytes,int concurrency) {
        if(directory==null || maxBytes<1 || maxBytes>20L*1024*1024*1024 || concurrency<1 || concurrency>8)throw new IllegalArgumentException("invalid image upload limits");
        this.access=access;this.applications=applications;this.images=images;this.centers=Map.copyOf(centers);
        this.directory=directory.toAbsolutePath().normalize();this.maxBytes=maxBytes;this.permits=new Semaphore(concurrency);
    }
    public ApplicationVersion upload(Actor actor,String namespace,String application,String version,Request request,long size,InputStream content) {
        access.require(actor,namespace,Action.WRITE);
        if(request==null || size<1 || size>maxBytes)throw ApplicationException.invalid("image archive must contain 1.."+maxBytes+" bytes");
        Registry center=centers.get(namespace);
        if(center==null)throw ApplicationException.invalid("image upload registry is not configured for namespace");
        if(!namespace.matches("[a-z][a-z0-9.-]*") || application==null || !application.matches("[a-z][a-z0-9.-]*"))
            throw ApplicationException.invalid("upload requires lowercase OCI-compatible namespace/application id");
        String repository=center.address()+"/"+namespace+"/"+application;
        var validated=applications.validateNew(actor,namespace,application,version,new ApplicationVersion(application,version,repository+":incoming",request.parameters()));
        if(!permits.tryAcquire())throw ApplicationException.conflict("image upload capacity is busy; retry after the active upload finishes");
        Path archive=null;
        try {
            Files.createDirectories(directory);
            archive=Files.createTempFile(directory,"cea-image-",".tar");
            long total=0;
            try(var output=Files.newOutputStream(archive)) {
                byte[] buffer=new byte[65536];int read;
                while((read=content.read(buffer))!=-1) {
                    total+=read;
                    if(total>size || total>maxBytes)throw ApplicationException.invalid("image archive exceeds declared/configured size");
                    output.write(buffer,0,read);
                }
            }
            if(total!=size)throw ApplicationException.invalid("image archive length does not match upload");
            // Unique import tag prevents concurrent uploads from overwriting an existing version's image.
            String digest=images.importArchive(archive,repository+":upload-"+UUID.randomUUID(),center);
            return applications.register(actor,namespace,application,version,new ApplicationVersion(application,version,repository+"@"+digest,validated.parameters()));
        } catch(IOException ex) { throw new SkopeoImageClient.Failure("Cannot stage image archive; check upload storage and available space"); }
        finally {
            try { if(archive!=null)Files.deleteIfExists(archive); }
            catch(IOException ex) { System.getLogger(ImageUploadService.class.getName()).log(System.Logger.Level.WARNING,"Image temporary file cleanup failed; inspect configured upload directory"); }
            permits.release();
        }
    }
}

package com.project.platform.deployment.application;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import java.util.List;
import static com.project.platform.deployment.application.ApplicationContractValidator.*;

/** Public application catalog boundary; reads resource versions only through their authorized API. */
public final class ApplicationCatalogService {
    private final JdbcApplicationRepository repository;
    private final ResourceCatalogService resources;
    private final AccessPolicy access;
    public ApplicationCatalogService(JdbcApplicationRepository repository,ResourceCatalogService resources,AccessPolicy access) {
        this.repository=repository;this.resources=resources;this.access=access;
    }
    public ApplicationVersion register(Actor actor,String namespace,String id,String version,ApplicationVersion value) {
        return repository.register(namespace,validate(actor,namespace,id,version,value));
    }
    /** Upload preflight: validate before importing bytes and reject an already registered version. */
    public ApplicationVersion validateNew(Actor actor,String namespace,String id,String version,ApplicationVersion value) {
        var normalized=validate(actor,namespace,id,version,value);
        if(repository.exists(namespace,id,version))throw ApplicationException.conflict("application version already exists; use a new version");
        return normalized;
    }
    private ApplicationVersion validate(Actor actor,String namespace,String id,String version,ApplicationVersion value) {
        access.require(actor,namespace,Action.WRITE);identifier(namespace);identifier(id);token(version,100);
        var normalized=normalize(value);
        if(!id.equals(normalized.applicationId()) || !version.equals(normalized.version())) throw ApplicationException.invalid("application id/version must match route");
        for(var parameter:normalized.parameters().values()) if(parameter.dataset()!=null) {
            for(var ref:parameter.dataset().allowed()) {
                var dataset=resources.dataset(actor,namespace,ref.datasetId(),ref.version());
                if(!dataset.format().equals(parameter.dataset().format())) throw ApplicationException.invalid("dataset format mismatch: "+ref.key());
            }
        }
        return normalized;
    }
    public ApplicationVersion get(Actor actor,String namespace,String id,String version) {
        access.require(actor,namespace,Action.READ);identifier(namespace);identifier(id);token(version,100);return repository.get(namespace,id,version);
    }
    public List<ApplicationVersion> list(Actor actor,String namespace,int limit,int offset) {
        access.require(actor,namespace,Action.READ);identifier(namespace);
        if(limit<1 || limit>100 || offset<0 || offset>1_000_000) throw ApplicationException.invalid("limit 1..100, offset 0..1000000 required");
        return repository.list(namespace,limit,offset);
    }
}

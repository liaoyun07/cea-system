package com.project.platform.dataflow.definition;

import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.runtime.model.WorkflowException;

/** Coordinates existing public catalog boundaries; never touches another module's tables. */
public final class DatasetRemovalService {
    private final ResourceCatalogService resources;
    private final ApplicationCatalogService applications;
    public DatasetRemovalService(ResourceCatalogService resources,ApplicationCatalogService applications) {
        this.resources=resources;this.applications=applications;
    }
    public void remove(Actor actor,String namespace,String id,String version) {
        resources.withDatasetTransaction(actor,namespace,()->{
            resources.dataset(actor,namespace,id,version);
            var references=applications.datasetReferences(actor,namespace,id,version);
            if(!references.isEmpty())throw WorkflowException.conflict("dataset is referenced by application contracts: "+String.join(", ",references));
            resources.removeUnreferencedDataset(actor,namespace,id,version);
            return null;
        });
    }
}

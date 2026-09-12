package com.project.platform.dataflow.definition;

import com.project.platform.deployment.application.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.kubernetes.KubernetesManagementService;

/** Cross-domain removal checks use public services. Saved revisions remain valid and Registry cleanup is separate. */
public final class ApplicationRemovalService {
    private final AccessPolicy access;
    private final FlowService flows;
    private final ApplicationCatalogService applications;
    private final KubernetesManagementService kubernetes;
    public ApplicationRemovalService(AccessPolicy access,FlowService flows,ApplicationCatalogService applications,KubernetesManagementService kubernetes) {
        this.access=access;this.flows=flows;this.applications=applications;this.kubernetes=kubernetes;
    }
    public void remove(Actor actor,String namespace,String id,String version) {
        access.require(actor,namespace,Action.WRITE);
        var application=applications.get(actor,namespace,id,version);
        var references=flows.applicationReferences(actor,namespace,id,version);
        if(!references.isEmpty())throw ApplicationException.conflict("application is referenced by saved Flow revisions: "+String.join(", ",references.stream().limit(10).toList()));
        String image=application.image();String repository=image.contains("@")?image.substring(0,image.indexOf('@')):image.substring(0,image.lastIndexOf(':'));
        if(kubernetes.applicationInUse(actor,namespace,id,version) || kubernetes.workloadImages(actor,namespace).stream().anyMatch(value->value.equals(image) || value.startsWith(repository+"@") || value.startsWith(repository+":")))
            throw ApplicationException.conflict("application repository is referenced by Kubernetes workloads");
        applications.removeUnreferenced(actor,namespace,id,version);
    }
}

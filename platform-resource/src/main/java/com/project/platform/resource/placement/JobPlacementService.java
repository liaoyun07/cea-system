package com.project.platform.resource.placement;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.resource.kubernetes.KubernetesConnections;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;

/** Resource owns placement facts and platform job slots, not Execution or physical CPU ownership. */
public final class JobPlacementService {
    public record Allocation(String clusterId,boolean released) {}
    private final ResourceCatalogService catalog;
    private final KubernetesConnections connections;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final Map<String,Map<String,Integer>> slots;
    private final AccessPolicy access;
    public JobPlacementService(ResourceCatalogService catalog,KubernetesConnections connections,JdbcTemplate jdbc,
                               TransactionTemplate transactions,Map<String,Map<String,Integer>> slots,AccessPolicy access) {
        this.catalog=catalog;this.connections=connections;this.jdbc=jdbc;this.transactions=transactions;this.access=access;
        this.slots=slots.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey,e->Map.copyOf(e.getValue())));
        for(var clusters:slots.values())for(int value:clusters.values())if(value<1 || value>100)throw new IllegalArgumentException("job slots must be 1..100");
    }
    public Allocation get(String namespace,String key) {
        var values=jdbc.query("SELECT cluster_id,released FROM res_job_reservation WHERE namespace=? AND allocation_id=?",(rs,n)->new Allocation(rs.getString(1),rs.getBoolean(2)),namespace,key);
        return values.isEmpty()?null:values.getFirst();
    }
    public Allocation reserve(Actor actor,String namespace,String key,PlacementRequest request) {
        access.require(actor,namespace,Action.EXECUTE);
        var existing=get(namespace,key);if(existing!=null)return existing;
        var eligible=new ArrayList<String>();
        for(var option:catalog.placementOptions(actor,namespace,request))if(option.eligible()) {
            if(!slots.getOrDefault(namespace,Map.of()).containsKey(option.clusterId()))continue;
            try(var client=connections.open(namespace,option.clusterId())) {
                if(client.nodes().list().getItems().stream().anyMatch(node->!Boolean.TRUE.equals(node.getSpec().getUnschedulable())
                        && node.getStatus()!=null && node.getStatus().getConditions()!=null
                        && node.getStatus().getConditions().stream().anyMatch(c->"Ready".equals(c.getType()) && "True".equals(c.getStatus()))))eligible.add(option.clusterId());
            }
        }
        if(eligible.isEmpty())throw ResourceException.invalid("no healthy configured cluster satisfies dataset locality");
        return transactions.execute(status->{
            // Stable lock order across parallel workers. Recheck reservation and enabled state while locked.
            for(String cluster:eligible.stream().sorted().toList())jdbc.queryForObject("SELECT enabled FROM res_cluster WHERE namespace=? AND id=? FOR UPDATE",Boolean.class,namespace,cluster);
            var previous=get(namespace,key);if(previous!=null)return previous;
            for(String cluster:eligible) {
                if(!catalog.cluster(actor,namespace,cluster).enabled())continue;
                int used=jdbc.queryForObject("SELECT COUNT(*) FROM res_job_reservation WHERE namespace=? AND cluster_id=? AND released=FALSE",Integer.class,namespace,cluster);
                if(used>=slots.get(namespace).get(cluster))continue;
                // A concurrent cancellation may have inserted a released tombstone first.
                jdbc.update("INSERT IGNORE INTO res_job_reservation(namespace,allocation_id,cluster_id,released) VALUES(?,?,?,FALSE)",namespace,key,cluster);
                return get(namespace,key);
            }
            return null; // No slot: the same Worker/Attempt waits; no business retry is consumed.
        });
    }
    public void release(String namespace,String key) {
        jdbc.update("INSERT INTO res_job_reservation(namespace,allocation_id,released) VALUES(?,?,TRUE) ON DUPLICATE KEY UPDATE released=TRUE",namespace,key);
    }
}

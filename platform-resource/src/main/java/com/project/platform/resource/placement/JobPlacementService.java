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
    public record Load(String clusterId,Kind kind,int capacity,int active,int waiting) {}
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
    /** Same health/locality facts used by ordinary placement; busy is not unavailable. */
    public List<Load> loads(Actor actor,String namespace,PlacementRequest request) {
        access.require(actor,namespace,Action.EXECUTE);
        var result=new ArrayList<Load>();
        for(var option:catalog.placementOptions(actor,namespace,request))if(option.eligible()) {
            Integer capacity=slots.getOrDefault(namespace,Map.of()).get(option.clusterId());
            if(capacity==null)continue;
            try(var client=connections.open(namespace,option.clusterId())) {
                if(client.nodes().list().getItems().stream().noneMatch(node->!Boolean.TRUE.equals(node.getSpec().getUnschedulable())
                        && node.getStatus()!=null && node.getStatus().getConditions()!=null
                        && node.getStatus().getConditions().stream().anyMatch(c->"Ready".equals(c.getType()) && "True".equals(c.getStatus()))))continue;
            } catch(io.fabric8.kubernetes.client.KubernetesClientException unavailable){continue;}
            int active=jdbc.queryForObject("SELECT COUNT(*) FROM res_job_reservation WHERE namespace=? AND cluster_id=? AND released=FALSE",Integer.class,namespace,option.clusterId());
            result.add(new Load(option.clusterId(),option.kind(),capacity,active,0));
        }
        return List.copyOf(result);
    }
    public Load terminalLoad(Actor actor,String ns,String cluster,String terminal,int capacity) {
        access.require(actor,ns,Action.EXECUTE);checkCapacity(capacity);
        int active=jdbc.queryForObject("SELECT COUNT(*) FROM res_terminal_reservation WHERE namespace=? AND cluster_id=? AND terminal_id=? AND released=FALSE AND admitted=TRUE",Integer.class,ns,cluster,terminal);
        int waiting=jdbc.queryForObject("SELECT COUNT(*) FROM res_terminal_reservation WHERE namespace=? AND cluster_id=? AND terminal_id=? AND released=FALSE AND admitted=FALSE",Integer.class,ns,cluster,terminal);
        return new Load(cluster,Kind.EDGE,capacity,active,waiting);
    }
    /** FIFO is registration order at this resource boundary, not task ID or Worker claim order. */
    public boolean reserveTerminal(Actor actor,String ns,String key,String cluster,String terminal,int capacity) {
        access.require(actor,ns,Action.EXECUTE);checkCapacity(capacity);
        return Boolean.TRUE.equals(transactions.execute(status->{
            jdbc.queryForObject("SELECT enabled FROM res_cluster WHERE namespace=? AND id=? FOR UPDATE",Boolean.class,ns,cluster);
            jdbc.update("INSERT IGNORE INTO res_terminal_reservation(namespace,allocation_id,cluster_id,terminal_id) VALUES(?,?,?,?)",ns,key,cluster,terminal);
            var row=jdbc.queryForMap("SELECT sequence_no,admitted,released FROM res_terminal_reservation WHERE namespace=? AND allocation_id=?",ns,key);
            if(Boolean.TRUE.equals(row.get("released")))return false;
            if(Boolean.TRUE.equals(row.get("admitted")))return true;
            int ahead=jdbc.queryForObject("SELECT COUNT(*) FROM res_terminal_reservation WHERE namespace=? AND cluster_id=? AND terminal_id=? AND released=FALSE AND (admitted=TRUE OR sequence_no<?)",Integer.class,ns,cluster,terminal,row.get("sequence_no"));
            if(ahead>=capacity)return false;
            jdbc.update("UPDATE res_terminal_reservation SET admitted=TRUE WHERE namespace=? AND allocation_id=?",ns,key);return true;
        }));
    }
    public void releaseTerminal(String ns,String key,String cluster,String terminal) {
        transactions.executeWithoutResult(status->{
            jdbc.queryForObject("SELECT enabled FROM res_cluster WHERE namespace=? AND id=? FOR UPDATE",Boolean.class,ns,cluster);
            jdbc.update("INSERT INTO res_terminal_reservation(namespace,allocation_id,cluster_id,terminal_id,released) VALUES(?,?,?,?,TRUE) ON DUPLICATE KEY UPDATE released=TRUE",ns,key,cluster,terminal);
        });
    }
    private static void checkCapacity(int capacity) {if(capacity<1 || capacity>100)throw ResourceException.invalid("terminal slots must be 1..100");}
    public void release(String namespace,String key) {
        jdbc.update("INSERT INTO res_job_reservation(namespace,allocation_id,released) VALUES(?,?,TRUE) ON DUPLICATE KEY UPDATE released=TRUE",namespace,key);
    }
}

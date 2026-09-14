package com.project.platform.resource.placement;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceException;
import java.util.*;
import java.util.function.Function;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Unfinished admitted input bytes, not CPU progress and not a task scheduler. */
public final class WorkloadLedger {
    public record Snapshot(long terminalBytes,long edgeBytes,long cloudBytes,boolean comparable) {}
    public record Choice<T>(String layer,T value) {}
    private final JdbcTemplate jdbc;private final TransactionTemplate transactions;private final AccessPolicy access;
    public WorkloadLedger(JdbcTemplate jdbc,TransactionTemplate transactions,AccessPolicy access) {this.jdbc=jdbc;this.transactions=transactions;this.access=access;}
    public <T> T accept(Actor actor,String ns,String key,String terminal,String edge,String cloud,String profile,long bytes,
                        Function<Snapshot,Choice<T>> decide) {
        access.require(actor,ns,Action.EXECUTE);
        if(bytes<1)throw ResourceException.invalid("positive measured workload required");
        return transactions.execute(status->{
            // Serialize layer admission and its resource snapshot across origins sharing a cloud.
            for(String cluster:new TreeSet<>(List.of(edge,cloud)))jdbc.queryForObject("SELECT enabled FROM res_cluster WHERE namespace=? AND id=? FOR UPDATE",Boolean.class,ns,cluster);
            var prior=jdbc.queryForList("SELECT layer,released FROM res_offload_workload WHERE namespace=? AND allocation_id=?",ns,key);
            if(!prior.isEmpty() && Boolean.TRUE.equals(prior.getFirst().get("released")))throw ResourceException.invalid("workload already released");
            long[] totals=new long[3];boolean comparable=true;
            var rows=jdbc.queryForList("""
                    SELECT layer,profile_json,input_bytes FROM res_offload_workload WHERE namespace=? AND released=FALSE AND allocation_id<>?
                    AND ((layer='TERMINAL' AND scope_id=?) OR (layer='EDGE' AND scope_id=?) OR (layer='CLOUD' AND scope_id=?))
                    """,ns,key,terminal,edge,cloud);
            for(var row:rows) {
                int index=List.of("TERMINAL","EDGE","CLOUD").indexOf(row.get("layer"));
                totals[index]=Math.addExact(totals[index],((Number)row.get("input_bytes")).longValue());
                if(!profile.equals(row.get("profile_json")))comparable=false;
            }
            int untracked=jdbc.queryForObject("""
                    SELECT COUNT(*) FROM res_job_reservation r LEFT JOIN res_offload_workload w
                    ON r.namespace=w.namespace AND r.allocation_id=w.allocation_id
                    WHERE r.namespace=? AND r.cluster_id IN (?,?) AND r.released=FALSE AND w.allocation_id IS NULL
                    """,Integer.class,ns,edge,cloud);
            untracked+=jdbc.queryForObject("""
                    SELECT COUNT(*) FROM res_terminal_reservation r LEFT JOIN res_offload_workload w
                    ON r.namespace=w.namespace AND r.allocation_id=w.allocation_id
                    WHERE r.namespace=? AND r.terminal_id=? AND r.released=FALSE AND w.allocation_id IS NULL
                    """,Integer.class,ns,terminal);
            var choice=decide.apply(new Snapshot(totals[0],totals[1],totals[2],comparable && untracked==0));
            String scope=switch(choice.layer()){case "TERMINAL"->terminal;case "EDGE"->edge;case "CLOUD"->cloud;default->throw ResourceException.invalid("invalid workload layer");};
            if(!prior.isEmpty() && !choice.layer().equals(prior.getFirst().get("layer")))throw ResourceException.invalid("workload layer changed");
            jdbc.update("INSERT IGNORE INTO res_offload_workload(namespace,allocation_id,layer,scope_id,profile_json,input_bytes) VALUES(?,?,?,?,?,?)",ns,key,choice.layer(),scope,profile,bytes);
            return choice.value();
        });
    }
    /** Called only after the original Runner confirmed completion/stop, including pre-dispatch cancellation. */
    public void release(String ns,String key) {
        jdbc.update("INSERT INTO res_offload_workload(namespace,allocation_id,released) VALUES(?,?,TRUE) ON DUPLICATE KEY UPDATE released=TRUE",ns,key);
    }
}

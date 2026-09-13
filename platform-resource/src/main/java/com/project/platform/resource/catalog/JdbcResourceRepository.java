package com.project.platform.resource.catalog;

import com.project.platform.resource.catalog.ResourceCatalog.*;
import java.util.List;
import java.util.function.Supplier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Owns only res_* tables. No dependency on runtime repositories or execution state. */
public final class JdbcResourceRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    public JdbcResourceRepository(JdbcTemplate jdbc,TransactionTemplate transactions) { this.jdbc=jdbc;this.transactions=transactions; }
    public <T>T transaction(Supplier<T> work) { return transactions.execute(status->work.get()); }
    public Cluster putCluster(String namespace,Cluster cluster) {
        jdbc.update("INSERT INTO res_cluster(namespace,id,kind,enabled) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE kind=VALUES(kind),enabled=VALUES(enabled)",namespace,cluster.id(),cluster.kind().name(),cluster.enabled());
        return cluster;
    }
    public List<Cluster> clusters(String namespace,int limit,int offset) {
        return jdbc.query("SELECT id,kind,enabled FROM res_cluster WHERE namespace=? ORDER BY id LIMIT ? OFFSET ?",
                (rs,row)->new Cluster(rs.getString(1),Kind.valueOf(rs.getString(2)),rs.getBoolean(3)),namespace,limit,offset);
    }
    public Cluster cluster(String namespace,String id) {
        var rows=jdbc.query("SELECT id,kind,enabled FROM res_cluster WHERE namespace=? AND id=?",
                (rs,row)->new Cluster(rs.getString(1),Kind.valueOf(rs.getString(2)),rs.getBoolean(3)),namespace,id);
        if(rows.isEmpty()) throw ResourceException.missing("cluster not found: "+id);
        return rows.getFirst();
    }
    public DatasetVersion dataset(String namespace,String id,String version) {
        var formats=jdbc.queryForList("SELECT format FROM res_dataset_version WHERE namespace=? AND dataset_id=? AND version=? AND deleted=FALSE FOR UPDATE",String.class,namespace,id,version);
        if(formats.isEmpty()) throw ResourceException.missing("dataset version not found: "+id+"/"+version);
        var locations=jdbc.query("SELECT cluster_id,uri FROM res_dataset_location WHERE namespace=? AND dataset_id=? AND version=? ORDER BY cluster_id",
                (rs,row)->new Location(rs.getString(1),rs.getString(2)),namespace,id,version);
        return new DatasetVersion(id,version,formats.getFirst(),locations);
    }
    public List<DatasetVersion> datasets(String namespace,int limit,int offset) {
        var keys=jdbc.query("SELECT dataset_id,version FROM res_dataset_version WHERE namespace=? AND deleted=FALSE ORDER BY dataset_id,version LIMIT ? OFFSET ?",
                (rs,row)->List.of(rs.getString(1),rs.getString(2)),namespace,limit,offset);
        return keys.stream().map(k->dataset(namespace,k.get(0),k.get(1))).toList();
    }
    public DatasetVersion register(String namespace,DatasetVersion value) {
        try {
            return transaction(()->{
                jdbc.update("INSERT INTO res_dataset_version(namespace,dataset_id,version,format) VALUES(?,?,?,?)",namespace,value.datasetId(),value.version(),value.format());
                for(var location:value.locations()) jdbc.update("INSERT INTO res_dataset_location(namespace,dataset_id,version,cluster_id,uri) VALUES(?,?,?,?,?)",
                        namespace,value.datasetId(),value.version(),location.clusterId(),location.uri());
                return value;
            });
        } catch(DuplicateKeyException duplicate) {
            if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT deleted FROM res_dataset_version WHERE namespace=? AND dataset_id=? AND version=?",Boolean.class,namespace,value.datasetId(),value.version())))
                throw ResourceException.conflict("dataset version was removed; register a new version");
            var existing=dataset(namespace,value.datasetId(),value.version());
            if(existing.equals(value)) return existing;
            throw ResourceException.conflict("dataset version is immutable; register a new version");
        }
    }
    public void remove(String namespace,String id,String version) {
        if(jdbc.update("UPDATE res_dataset_version SET deleted=TRUE WHERE namespace=? AND dataset_id=? AND version=? AND deleted=FALSE",namespace,id,version)!=1)
            throw ResourceException.missing("dataset version not found");
    }
}

package com.project.platform.resource.storage;

import com.project.platform.resource.catalog.ResourceException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Measured complete file transfers; missing history is never a zero-second estimate. */
public final class TransferMeasurements {
    public record Rate(double bytesPerSecond,int transfers) {}
    private final JdbcTemplate jdbc;
    public TransferMeasurements(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public void record(String ns,String key,String stage,String file,String source,String target,long bytes,double seconds) {
        if(!Set.of("UPLOAD","DOWNLOAD").contains(stage) || bytes<1 || !Double.isFinite(seconds) || seconds<=0 || seconds>3600)
            throw ResourceException.invalid("invalid measured transfer");
        jdbc.update("""
                INSERT IGNORE INTO res_file_transfer(namespace,allocation_id,stage,file_name,source_id,target_id,bytes,seconds)
                VALUES(?,?,?,?,?,?,?,?)
                """,ns,key,stage,file,source,target,bytes,seconds);
    }
    public Rate rate(String ns,String source,String target) {
        var rows=jdbc.queryForList("SELECT bytes,seconds FROM res_file_transfer WHERE namespace=? AND source_id=? AND target_id=? ORDER BY sequence_no DESC LIMIT 20",ns,source,target);
        if(rows.isEmpty())return null;
        double bytes=0,seconds=0;for(var row:rows){bytes+=((Number)row.get("bytes")).doubleValue();seconds+=((Number)row.get("seconds")).doubleValue();}
        return new Rate(bytes/seconds,rows.size());
    }
    public Double seconds(String ns,String source,String target,long bytes) {var rate=rate(ns,source,target);return rate==null?null:bytes/rate.bytesPerSecond();}
}

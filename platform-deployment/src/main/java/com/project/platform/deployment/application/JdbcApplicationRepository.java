package com.project.platform.deployment.application;

import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Sole owner of dep_application_version. Each registration is one atomic row insert. */
public final class JdbcApplicationRepository {
    private final JdbcTemplate jdbc;
    private final JsonMapper json=JsonMapper.builder().enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();
    public JdbcApplicationRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public boolean exists(String namespace,String id,String version) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM dep_application_version WHERE namespace=? AND application_id=? AND version=?",Integer.class,namespace,id,version)>0;
    }
    public ApplicationVersion register(String namespace,ApplicationVersion value) {
        String document=json.writeValueAsString(value);
        try {
            jdbc.update("INSERT INTO dep_application_version(namespace,application_id,version,contract_json) VALUES(?,?,?,?)",namespace,value.applicationId(),value.version(),document);
            return value;
        } catch(DuplicateKeyException duplicate) {
            if(Boolean.TRUE.equals(jdbc.queryForObject("SELECT deleted FROM dep_application_version WHERE namespace=? AND application_id=? AND version=?",Boolean.class,namespace,value.applicationId(),value.version())))
                throw ApplicationException.conflict("application version was removed; register a new version");
            var existing=get(namespace,value.applicationId(),value.version());
            if(existing.equals(value)) return existing;
            throw ApplicationException.conflict("application version is immutable; register a new version");
        }
    }
    public ApplicationVersion get(String namespace,String id,String version) {
        var rows=jdbc.queryForList("SELECT contract_json FROM dep_application_version WHERE namespace=? AND application_id=? AND version=? AND deleted=FALSE",String.class,namespace,id,version);
        if(rows.isEmpty()) throw ApplicationException.missing("application version not found: "+id+"/"+version);
        return decode(rows.getFirst());
    }
    public List<ApplicationVersion> list(String namespace,int limit,int offset) {
        return jdbc.query("SELECT contract_json FROM dep_application_version WHERE namespace=? AND deleted=FALSE ORDER BY application_id,version LIMIT ? OFFSET ?",
                (rs,row)->decode(rs.getString(1)),namespace,limit,offset);
    }
    public void delete(String namespace,String id,String version) {
        if(jdbc.update("UPDATE dep_application_version SET deleted=TRUE WHERE namespace=? AND application_id=? AND version=? AND deleted=FALSE",namespace,id,version)!=1)
            throw ApplicationException.missing("application version not found");
    }
    /** Retired contracts remain image-discovery candidates, never active execution contracts. */
    public java.util.Map<String,java.util.Set<String>> knownImages(String namespace) {
        var result=new java.util.HashMap<String,java.util.Set<String>>();
        jdbc.query("SELECT application_id,JSON_UNQUOTE(JSON_EXTRACT(contract_json,'$.image')) FROM dep_application_version WHERE namespace=?",
                (org.springframework.jdbc.core.RowCallbackHandler)rs->result.computeIfAbsent(rs.getString(1),ignored->new java.util.HashSet<>()).add(rs.getString(2)),namespace);
        return result;
    }
    private ApplicationVersion decode(String source) { return ApplicationContractValidator.normalize(json.readValue(source,ApplicationVersion.class)); }
}

package com.project.platform.dataflow.definition;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.definition.FlowValidator;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.WorkflowException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Immutable small text files. A pinned revision is the Flow's reproducible execution reference. */
public final class NamespaceFileService {
    public record File(String path,int revision,String content) {}
    public record Entry(String path,int revision) {}
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final AccessPolicy access;
    public NamespaceFileService(JdbcTemplate jdbc,TransactionTemplate transactions,AccessPolicy access) {
        this.jdbc=jdbc;this.transactions=transactions;this.access=access;
    }
    public File save(Actor actor,String namespace,String path,int expectedRevision,String content) {
        access.require(actor,namespace,Action.WRITE);FlowValidator.namespacePath(path);
        if(expectedRevision<0 || expectedRevision==Integer.MAX_VALUE || content==null || content.getBytes(StandardCharsets.UTF_8).length>65536)
            throw WorkflowException.invalid("file","nonnegative expectedRevision and at most 64KiB UTF-8 required");
        try {return transactions.execute(status->{
            int current=jdbc.queryForObject("SELECT COALESCE(MAX(revision),0) FROM df_namespace_file WHERE namespace=? AND path=?",Integer.class,namespace,path);
            if(current!=expectedRevision)throw WorkflowException.conflict("file revision changed");
            jdbc.update("INSERT INTO df_namespace_file(namespace,path,revision,content) VALUES(?,?,?,?)",namespace,path,current+1,content);
            return new File(path,current+1,content);
        });} catch(DuplicateKeyException ex){throw WorkflowException.conflict("file revision changed");}
    }
    public File get(Actor actor,String namespace,String path,int revision) {
        access.require(actor,namespace,Action.READ);return read(namespace,path,revision);
    }
    public File forExecution(Actor actor,String namespace,String path,int revision) {
        access.require(actor,namespace,Action.EXECUTE);return read(namespace,path,revision);
    }
    private File read(String namespace,String path,int revision) {
        FlowValidator.namespacePath(path);
        if(revision<1)throw WorkflowException.invalid("revision","positive pinned revision required");
        var rows=jdbc.query("SELECT content FROM df_namespace_file WHERE namespace=? AND path=? AND revision=?",
                (rs,row)->new File(path,revision,rs.getString(1)),namespace,path,revision);
        if(rows.isEmpty())throw WorkflowException.missing("namespace file revision not found");
        return rows.getFirst();
    }
    public List<Entry> list(Actor actor,String namespace,int limit,int offset) {
        access.require(actor,namespace,Action.READ);ExecutionService.page(limit,offset);
        return jdbc.query("SELECT path,MAX(revision) FROM df_namespace_file WHERE namespace=? GROUP BY path ORDER BY path LIMIT ? OFFSET ?",
                (rs,row)->new Entry(rs.getString(1),rs.getInt(2)),namespace,limit,offset);
    }
}

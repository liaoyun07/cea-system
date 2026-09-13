package com.project.platform.server.security;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.model.WorkflowException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;

/** Database is the human account source of truth; CONNECT machine accounts remain external. */
public final class IdentityDirectory implements UserDetailsService {
    public enum Role { ADMIN, USER }
    public record Profile(String name,Role role,boolean enabled,Set<String> namespaces,Set<Action> actions) {}
    public record Create(String name,String password,Role role,Set<String> namespaces) {}
    public record Update(Role role,boolean enabled,Set<String> namespaces) {}
    public record PasswordChange(String currentPassword,String newPassword) {}
    public record PasswordReset(String password) {}
    private record Stored(Profile profile,String hash) {}
    private final Map<String,Actor> machines=new HashMap<>();
    private final Map<String,UserDetails> machineUsers=new HashMap<>();
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final PasswordEncoder encoder;
    private final JsonMapper json=JsonMapper.builder().build();
    public IdentityDirectory(SecurityProperties properties,PasswordEncoder encoder,JdbcTemplate jdbc,TransactionTemplate transactions) {
        this.jdbc=jdbc;this.transactions=transactions;this.encoder=encoder;
        if(properties.users()==null || properties.users().isEmpty())throw new IllegalArgumentException("Configure bootstrap or machine accounts");
        var names=new HashSet<String>();
        for(var account:properties.users()) {
            if(account.name()==null || account.name().isBlank() || account.name().length()>100 || account.password()==null || account.password().isBlank()
                    || account.namespaces()==null || account.namespaces().isEmpty() || account.actions()==null || account.actions().isEmpty() || !names.add(account.name()))
                throw new IllegalArgumentException("Unique account, credentials, namespaces and actions required");
            var actor=new Actor(account.name(),account.namespaces(),account.actions());
            if(actor.actions().contains(Action.CONNECT)) {
                if(actor.actions().size()!=1 || exists(account.name()))throw new IllegalArgumentException("CONNECT account must be machine-only and cannot collide with a human account");
                machines.put(actor.name(),actor);
                machineUsers.put(actor.name(),User.withUsername(actor.name()).password(encoder.encode(account.password())).authorities("API").build());
            } else {
                jdbc.update("INSERT IGNORE INTO sec_user(name,password_hash,role,enabled,namespaces_json,actions_json) VALUES(?,?,?,TRUE,?,?)",
                        actor.name(),encoder.encode(account.password()),(account.role()==null?Role.USER:account.role()).name(),json.writeValueAsString(actor.namespaces()),json.writeValueAsString(actor.actions()));
            }
        }
    }
    private boolean exists(String name) { return jdbc.queryForObject("SELECT COUNT(*) FROM sec_user WHERE name=?",Integer.class,name)>0; }
    private Stored stored(String name) {
        var rows=jdbc.query("SELECT * FROM sec_user WHERE name=?",(rs,row)->new Stored(new Profile(rs.getString("name"),Role.valueOf(rs.getString("role")),rs.getBoolean("enabled"),
                Set.copyOf(Arrays.asList(json.readValue(rs.getString("namespaces_json"),String[].class))),
                Set.copyOf(Arrays.asList(json.readValue(rs.getString("actions_json"),Action[].class)))),rs.getString("password_hash")),name);
        if(rows.isEmpty())throw new UsernameNotFoundException("account not found");
        return rows.getFirst();
    }
    @Override public UserDetails loadUserByUsername(String name) {
        // Authentication erases credentials from the returned principal; never expose the stored instance.
        if(machineUsers.containsKey(name))return User.withUserDetails(machineUsers.get(name)).build();
        var saved=stored(name);
        return User.withUsername(name).password(saved.hash()).disabled(!saved.profile().enabled()).authorities("API").build();
    }
    /** Accepted Worker identity remains available after login is disabled. Authentication rejects disabled users. */
    public Actor actor(String name) {
        if(machines.containsKey(name))return machines.get(name);
        try {var p=stored(name).profile();return new Actor(name,p.namespaces(),p.actions());}
        catch(UsernameNotFoundException ex){throw new AccessPolicy.Forbidden();}
    }
    public Profile profile(String name,String namespace) {
        if(machines.containsKey(name))throw new AccessPolicy.Forbidden();
        var p=stored(name).profile();
        if(!p.enabled() || !p.namespaces().contains(namespace))throw new AccessPolicy.Forbidden();
        return p;
    }
    private Profile admin(String name,String namespace) {
        var p=profile(name,namespace);if(p.role()!=Role.ADMIN)throw new AccessPolicy.Forbidden();return p;
    }
    public List<Profile> list(String name,String namespace,int limit,int offset) {
        var manager=admin(name,namespace);
        com.project.platform.runtime.execution.ExecutionService.page(limit,offset);
        return jdbc.queryForList("SELECT name FROM sec_user ORDER BY name",String.class).stream().map(n->stored(n).profile())
                .filter(p->manager.namespaces().containsAll(p.namespaces())).skip(offset).limit(limit).toList();
    }
    public Profile create(String name,String namespace,Create request) {
        if(request==null || request.name()==null || !request.name().matches("[A-Za-z][A-Za-z0-9_.-]{0,99}") || machines.containsKey(request.name()))
            throw WorkflowException.invalid("name","unique human account identifier required");
        password(request.password());
        return transactions.execute(status->{
            lockAccounts();validate(admin(name,namespace),request.role(),request.namespaces());
            if(exists(request.name()))throw WorkflowException.conflict("account already exists");
            jdbc.update("INSERT INTO sec_user(name,password_hash,role,enabled,namespaces_json,actions_json) VALUES(?,?,?,TRUE,?,?)",
                    request.name(),encoder.encode(request.password()),request.role().name(),json.writeValueAsString(request.namespaces()),json.writeValueAsString(Set.of(Action.READ,Action.WRITE,Action.EXECUTE)));
            return stored(request.name()).profile();
        });
    }
    public Profile update(String name,String namespace,String target,Update request) {
        if(request==null)throw WorkflowException.invalid("user","configuration required");
        return transactions.execute(status->{
            lockAccounts();var manager=admin(name,namespace);var old=target(manager,target);
            validate(manager,request.role(),request.namespaces());
            if(name.equals(target) && (!request.enabled() || request.role()!=Role.ADMIN || !request.namespaces().contains(namespace)))
                throw WorkflowException.conflict("cannot disable, demote or remove current namespace from yourself");
            jdbc.update("UPDATE sec_user SET role=?,enabled=?,namespaces_json=? WHERE name=?",request.role().name(),request.enabled(),json.writeValueAsString(request.namespaces()),target);
            if(old.role()==Role.ADMIN && jdbc.queryForObject("SELECT COUNT(*) FROM sec_user WHERE role='ADMIN' AND enabled=TRUE",Integer.class)==0)
                throw WorkflowException.conflict("at least one enabled administrator must remain");
            return stored(target).profile();
        });
    }
    public void changePassword(String name,String namespace,PasswordChange request) {
        if(request==null || request.currentPassword()==null)throw WorkflowException.invalid("password","current and new password required");
        password(request.newPassword());
        transactions.executeWithoutResult(status->{
            lockAccounts();profile(name,namespace);
            if(!encoder.matches(request.currentPassword(),stored(name).hash()))throw WorkflowException.invalid("currentPassword","current password is incorrect");
            jdbc.update("UPDATE sec_user SET password_hash=? WHERE name=?",encoder.encode(request.newPassword()),name);
        });
    }
    public void resetPassword(String name,String namespace,String target,PasswordReset request) {
        if(request==null)throw WorkflowException.invalid("password","required");password(request.password());
        transactions.executeWithoutResult(status->{
            lockAccounts();target(admin(name,namespace),target);
            if(name.equals(target))throw WorkflowException.invalid("user","use personal password change for your own account");
            jdbc.update("UPDATE sec_user SET password_hash=? WHERE name=?",encoder.encode(request.password()),target);
        });
    }
    private void lockAccounts() { jdbc.queryForList("SELECT name FROM sec_user ORDER BY name FOR UPDATE",String.class); }
    private Profile target(Profile manager,String name) {
        if(machines.containsKey(name) || !exists(name))throw WorkflowException.missing("human account not found");
        var target=stored(name).profile();
        if(!manager.namespaces().containsAll(target.namespaces()))throw new AccessPolicy.Forbidden();
        return target;
    }
    private void validate(Profile manager,Role role,Set<String> namespaces) {
        if(role==null || namespaces==null || namespaces.isEmpty() || namespaces.size()>100 || namespaces.stream().anyMatch(n->n==null || !n.matches("[A-Za-z][A-Za-z0-9_.-]{0,99}")))
            throw WorkflowException.invalid("user","role and 1..100 valid namespaces required");
        if(!manager.namespaces().containsAll(namespaces))throw new AccessPolicy.Forbidden();
    }
    private void password(String value) {
        if(value==null || value.length()<10 || value.getBytes(StandardCharsets.UTF_8).length>72 || value.isBlank())
            throw WorkflowException.invalid("password","password requires at least 10 characters and at most 72 UTF-8 bytes");
    }
}

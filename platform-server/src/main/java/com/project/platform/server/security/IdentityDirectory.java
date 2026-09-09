package com.project.platform.server.security;

import com.project.platform.foundation.identity.AccessPolicy.Actor;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;

/** S1 local account adapter. Credentials are external configuration, never request headers. */
public final class IdentityDirectory {
    private final Map<String, Actor> actors = new LinkedHashMap<>();
    private final List<UserDetails> users;

    public IdentityDirectory(SecurityProperties properties, PasswordEncoder encoder) {
        if (properties.users() == null || properties.users().isEmpty()) throw new IllegalArgumentException("Configure at least one account");
        users = properties.users().stream().map(account -> {
            if (account.name() == null || account.name().isBlank() || account.name().length() > 100
                    || account.password() == null || account.password().isBlank()
                    || account.namespaces() == null || account.namespaces().isEmpty()
                    || account.actions() == null || account.actions().isEmpty()) {
                throw new IllegalArgumentException("Account identity, credentials, namespaces and actions are required");
            }
            Actor actor = new Actor(account.name(), account.namespaces(), account.actions());
            if (actors.putIfAbsent(account.name(), actor) != null) throw new IllegalArgumentException("Duplicate account name");
            return (UserDetails) User.withUsername(account.name()).password(encoder.encode(account.password())).authorities("API").build();
        }).toList();
    }
    public List<UserDetails> users() { return users; }
    public Actor actor(String authenticatedName) {
        Actor actor = actors.get(authenticatedName);
        if (actor == null) throw new com.project.platform.foundation.identity.AccessPolicy.Forbidden();
        return actor;
    }
}


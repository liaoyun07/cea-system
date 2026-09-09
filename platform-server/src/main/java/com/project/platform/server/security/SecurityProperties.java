package com.project.platform.server.security;

import com.project.platform.foundation.identity.AccessPolicy.Action;
import java.util.List;
import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("platform.security")
public record SecurityProperties(List<Account> users) {
    public record Account(String name, String password, Set<String> namespaces, Set<Action> actions) {}
}


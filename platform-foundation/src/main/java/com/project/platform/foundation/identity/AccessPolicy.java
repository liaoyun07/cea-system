package com.project.platform.foundation.identity;

import java.util.Set;

/** Authenticated identity is supplied by the transport, never by request JSON. */
public final class AccessPolicy {
    public enum Action { READ, WRITE, EXECUTE }
    public record Actor(String name, Set<String> namespaces, Set<Action> actions) {
        public Actor {
            namespaces = Set.copyOf(namespaces);
            actions = Set.copyOf(actions);
        }
    }
    public static final class Forbidden extends RuntimeException {
        public Forbidden() { super("namespace or action is not permitted"); }
    }

    public void require(Actor actor, String namespace, Action action) {
        if (actor == null || !actor.namespaces().contains(namespace) || !actor.actions().contains(action)) {
            throw new Forbidden();
        }
    }
}


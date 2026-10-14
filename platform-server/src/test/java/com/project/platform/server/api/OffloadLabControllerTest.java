package com.project.platform.server.api;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.server.security.IdentityDirectory;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OffloadLabControllerTest {
    @TempDir Path temp;

    @Test void authenticatesNamespaceAndActionBeforeProxyingWithoutWorkflow() throws Exception {
        var identities = mock(IdentityDirectory.class);
        when(identities.actor("reader")).thenReturn(new Actor("reader", Set.of("lab", "other"), Set.of(Action.READ)));
        when(identities.actor("operator")).thenReturn(new Actor("operator", Set.of("lab"), Set.of(Action.READ, Action.EXECUTE)));
        var token = temp.resolve("token");
        Files.writeString(token, "isolated-test-token");
        var received = new AtomicReference<String>();
        var http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        http.createContext("/runs", exchange -> {
            received.set(exchange.getRequestMethod() + " " + exchange.getRequestURI() + " " + exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = "{\"id\":\"oil-123456789abc\"}".getBytes();
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        http.start();
        try {
            var controller = new OffloadLabController(identities, new AccessPolicy(), "http://127.0.0.1:" + http.getAddress().getPort(), "lab", token.toString());
            assertEquals(200, controller.list(() -> "reader", "lab", "runs").getStatusCode().value());
            assertEquals("GET /runs Bearer isolated-test-token", received.get());
            received.set(null);
            assertThrows(AccessPolicy.Forbidden.class, () -> controller.start(() -> "reader", "lab", "{}"));
            assertThrows(AccessPolicy.Forbidden.class, () -> controller.list(() -> "reader", "other", "runs"));
            assertNull(received.get());
            assertEquals(200, controller.start(() -> "operator", "lab", "{\"strategy\":\"LOCAL\"}").getStatusCode().value());
            assertEquals("POST /runs Bearer isolated-test-token", received.get());
        } finally { http.stop(0); }
    }

    @Test void disabledLabDoesNotBreakExistingServer() throws Exception {
        var identities = mock(IdentityDirectory.class);
        when(identities.actor("reader")).thenReturn(new Actor("reader", Set.of("lab"), Set.of(Action.READ)));
        var controller = new OffloadLabController(identities, new AccessPolicy(), "", "lab", "");
        var error = assertThrows(ResponseStatusException.class, () -> controller.list(() -> "reader", "lab", "runs"));
        assertEquals(503, error.getStatusCode().value());
    }
}

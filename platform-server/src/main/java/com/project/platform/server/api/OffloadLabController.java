package com.project.platform.server.api;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.Action;
import com.project.platform.server.security.IdentityDirectory;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

/** Authenticated experiment UI adapter. No execution decisions, SQL or workflow calls. */
@RestController
@RequestMapping("/api/namespaces/{namespace}/edge/offload-lab")
public final class OffloadLabController {
    private final IdentityDirectory identities;
    private final AccessPolicy access;
    private final String endpoint, configuredNamespace, token;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    public OffloadLabController(IdentityDirectory identities, AccessPolicy access,
            @Value("${platform.offload-lab.endpoint:}") String endpoint,
            @Value("${platform.offload-lab.namespace:lab}") String namespace,
            @Value("${platform.offload-lab.token-file:}") String tokenFile) throws java.io.IOException {
        this.identities = identities;
        this.access = access;
        this.endpoint = endpoint;
        this.configuredNamespace = namespace;
        this.token = tokenFile.isBlank() ? "" : Files.readString(Path.of(tokenFile)).strip();
    }

    @GetMapping("/{collection:devices|runs}")
    public ResponseEntity<String> list(Principal p, @PathVariable String namespace, @PathVariable String collection) {
        return call(p, namespace, "/" + collection, null);
    }

    @GetMapping("/runs/{id:oil-[a-f0-9]{12}}")
    public ResponseEntity<String> get(Principal p, @PathVariable String namespace, @PathVariable String id) {
        return call(p, namespace, "/runs/" + id, null);
    }

    @PostMapping("/runs")
    public ResponseEntity<String> start(Principal p, @PathVariable String namespace, @RequestBody String body) {
        return call(p, namespace, "/runs", body);
    }

    @PostMapping("/runs/{id:oil-[a-f0-9]{12}}/{operation:stop|strategy}")
    public ResponseEntity<String> change(Principal p, @PathVariable String namespace, @PathVariable String id,
            @PathVariable String operation, @RequestBody(required=false) String body) {
        return call(p, namespace, "/runs/" + id + "/" + operation, body == null ? "{}" : body);
    }

    private ResponseEntity<String> call(Principal principal, String namespace, String path, String body) {
        access.require(identities.actor(principal.getName()), namespace, body == null ? Action.READ : Action.EXECUTE);
        if (!configuredNamespace.equals(namespace)) throw new AccessPolicy.Forbidden();
        if (endpoint.isBlank() || token.isBlank()) throw new ResponseStatusException(SERVICE_UNAVAILABLE, "独立卸载实验尚未配置");
        var request = HttpRequest.newBuilder(URI.create(endpoint + path)).timeout(Duration.ofSeconds(20))
                .header("Authorization", "Bearer " + token).header("Content-Type", "application/json");
        if (body == null) request.GET(); else request.POST(HttpRequest.BodyPublishers.ofString(body));
        try {
            var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            return ResponseEntity.status(response.statusCode()).header("Content-Type", "application/json").body(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(BAD_GATEWAY, "实验服务请求中断");
        } catch (java.io.IOException e) {
            throw new ResponseStatusException(BAD_GATEWAY, "实验服务暂不可用");
        }
    }
}

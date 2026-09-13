package com.project.platform.server.api;

import java.util.Map;
import com.project.platform.runtime.execution.ExecutionService;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;

/** Credential-free readiness for deployment; exposes no connection or identity details. */
@RestController
@RequestMapping("/health")
public final class HealthController {
    private final ExecutionService executions;
    public HealthController(ExecutionService executions) { this.executions=executions; }
    @GetMapping
    public ResponseEntity<Map<String,String>> health() {
        try { executions.checkDatabase();return ResponseEntity.ok(Map.of("status","UP")); }
        catch(org.springframework.dao.DataAccessException failure) { return ResponseEntity.status(503).body(Map.of("status","DOWN")); }
    }
}

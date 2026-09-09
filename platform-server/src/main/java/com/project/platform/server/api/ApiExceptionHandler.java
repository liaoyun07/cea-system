package com.project.platform.server.api;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.runtime.model.WorkflowException;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MissingRequestValueException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public final class ApiExceptionHandler {
    @ExceptionHandler(io.fabric8.kubernetes.client.KubernetesClientException.class)
    public ResponseEntity<Map<String,String>> kubernetes(io.fabric8.kubernetes.client.KubernetesClientException exception) {
        int status=exception.getCode()==409?409:502;
        return ResponseEntity.status(status).body(Map.of("code","KUBERNETES_REQUEST_FAILED","message","Kubernetes request failed (status "+exception.getCode()+"); check configured cluster credentials and resource state"));
    }
    @ExceptionHandler(com.project.platform.deployment.distribution.SkopeoImageClient.Failure.class)
    public ResponseEntity<Map<String,String>> imagePreparation(com.project.platform.deployment.distribution.SkopeoImageClient.Failure exception) {
        return ResponseEntity.status(502).body(Map.of("code","IMAGE_PREPARATION_FAILED","message",exception.getMessage()));
    }
    @ExceptionHandler(com.project.platform.deployment.application.ApplicationException.class)
    public ResponseEntity<Map<String,String>> application(com.project.platform.deployment.application.ApplicationException exception) {
        int status=switch(exception.kind()) { case INVALID -> 422; case CONFLICT -> 409; case NOT_FOUND -> 404; };
        return ResponseEntity.status(status).body(Map.of("code",exception.kind().name(),"message",exception.getMessage()));
    }
    @ExceptionHandler(com.project.platform.resource.catalog.ResourceException.class)
    public ResponseEntity<Map<String,String>> resource(com.project.platform.resource.catalog.ResourceException exception) {
        int status=switch(exception.kind()) { case INVALID -> 422; case CONFLICT -> 409; case NOT_FOUND -> 404; };
        return ResponseEntity.status(status).body(Map.of("code",exception.kind().name(),"message",exception.getMessage()));
    }
    @ExceptionHandler(WorkflowException.class)
    public ResponseEntity<Map<String,String>> workflow(WorkflowException exception) {
        int status = switch(exception.kind()) { case INVALID -> 422; case CONFLICT -> 409; case NOT_FOUND -> 404; };
        return ResponseEntity.status(status).body(Map.of("code", exception.kind().name(), "message", exception.getMessage()));
    }
    @ExceptionHandler(AccessPolicy.Forbidden.class)
    public ResponseEntity<Map<String,String>> forbidden() {
        return ResponseEntity.status(403).body(Map.of("code","FORBIDDEN","message","namespace or action is not permitted"));
    }
    @ExceptionHandler({HttpMessageNotReadableException.class, MissingRequestValueException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String,String>> malformed() {
        return ResponseEntity.badRequest().body(Map.of("code","BAD_REQUEST","message","malformed request or missing field"));
    }
}

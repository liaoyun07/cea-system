package com.project.platform.runtime.model;

/** Safe public failures; infrastructure exceptions are not converted to business success. */
public final class WorkflowException extends RuntimeException {
    public enum Kind { INVALID, NOT_FOUND, CONFLICT }
    private final Kind kind;

    public WorkflowException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }
    public Kind kind() { return kind; }
    public static WorkflowException invalid(String path, String message) {
        return new WorkflowException(Kind.INVALID, path + ": " + message);
    }
    public static WorkflowException missing(String message) {
        return new WorkflowException(Kind.NOT_FOUND, message);
    }
    public static WorkflowException conflict(String message) {
        return new WorkflowException(Kind.CONFLICT, message);
    }
}


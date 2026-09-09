package com.project.platform.runtime.model;

public enum ExecutionState {
    CREATED, QUEUED, RUNNING, RETRYING, KILLING, SUCCESS, FAILED, KILLED, SKIPPED;
    public boolean terminal() { return this == SUCCESS || this == FAILED || this == KILLED || this == SKIPPED; }
}

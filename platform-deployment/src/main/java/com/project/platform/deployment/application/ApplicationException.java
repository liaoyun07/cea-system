package com.project.platform.deployment.application;

public final class ApplicationException extends RuntimeException {
    public enum Kind { INVALID, NOT_FOUND, CONFLICT }
    private final Kind kind;
    private ApplicationException(Kind kind,String message) { super(message);this.kind=kind; }
    public Kind kind() { return kind; }
    public static ApplicationException invalid(String message) { return new ApplicationException(Kind.INVALID,message); }
    public static ApplicationException missing(String message) { return new ApplicationException(Kind.NOT_FOUND,message); }
    public static ApplicationException conflict(String message) { return new ApplicationException(Kind.CONFLICT,message); }
}

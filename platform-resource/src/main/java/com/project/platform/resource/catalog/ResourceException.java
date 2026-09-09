package com.project.platform.resource.catalog;

public final class ResourceException extends RuntimeException {
    public enum Kind { INVALID, NOT_FOUND, CONFLICT }
    private final Kind kind;
    public ResourceException(Kind kind,String message) { super(message);this.kind=kind; }
    public Kind kind() { return kind; }
    public static ResourceException invalid(String message) { return new ResourceException(Kind.INVALID,message); }
    public static ResourceException missing(String message) { return new ResourceException(Kind.NOT_FOUND,message); }
    public static ResourceException conflict(String message) { return new ResourceException(Kind.CONFLICT,message); }
}

package com.project.platform.runtime.worker;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/** The same command and named-file protocol is consumed by Docker and Kubernetes. */
public final class ContainerTask {
    private ContainerTask() {}
    public record Spec(String image,List<String> command,Map<String,String> environment,List<String> inputs,List<String> outputs) {}
    public interface Filesystem {
        void download(String name,Path destination) throws Exception;
        String publish(String name,Path source) throws Exception;
        String published(String name) throws Exception;
    }
    /** Kubernetes-only file plan. JSON grants are ephemeral and mounted only in helper containers. */
    public interface Transfers {
        String authorization() throws Exception;
        String published(String name) throws Exception;
        default void inputReport(String report) throws Exception {}
    }
    static final String WRAPPER="""
            mkdir -p /cea-work/in /cea-work/out
            while [ ! -f /cea-work/start ]; do sleep 0.2; done
            "$@"
            code=$?
            printf '%s' "$code" > /cea-work/exit.tmp
            mv /cea-work/exit.tmp /cea-work/exit
            while [ ! -f /cea-work/published ]; do sleep 0.2; done
            exit "$code"
            """;
    public static String name(WorkerJob job) {return "cea-"+job.taskRunId()+"-a"+job.attemptNo();}
}

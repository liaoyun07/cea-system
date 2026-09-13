package com.project.platform.server;

import java.nio.file.Path;
import java.util.*;

/** Test-only Windows/Linux transport; builds and exports with the real rootless BuildKit daemon. */
public final class BuildkitTestBridge {
    public static void main(String[] args)throws Exception {
        String tool=args[0],temporary="/home/user/cea-build-test-"+UUID.randomUUID(),destination=null;
        int code=1;
        try {
            run("docker","exec",tool,"mkdir","-p",temporary);
            var invocation=new ArrayList<>(List.of("docker","exec",tool,"buildctl","--addr","unix:///run/user/1000/buildkit/buildkitd.sock"));
            for(int i=1;i<args.length;i++) {
                String value=args[i];
                if(value.startsWith("context=")) {
                    run("docker","cp",Path.of(value.substring(8)).toAbsolutePath().toString(),tool+":"+temporary+"/context");
                    value="context="+temporary+"/context";
                } else if(value.startsWith("dockerfile="))value="dockerfile="+temporary+"/context";
                else if(value.startsWith("type=docker,") && value.contains(",dest=")) {
                    int split=value.indexOf(",dest=");destination=value.substring(split+6);
                    value=value.substring(0,split)+",dest="+temporary+"/image.tar";
                }
                invocation.add(value);
            }
            code=new ProcessBuilder(invocation).inheritIO().start().waitFor();
            if(code==0)run("docker","cp",tool+":"+temporary+"/image.tar",destination);
        } finally {
            // This exact path is generated above, never a caller-supplied path or production volume.
            run("docker","exec","--user","0",tool,"rm","-rf",temporary);
        }
        System.exit(code);
    }
    private static void run(String... command)throws Exception {
        if(new ProcessBuilder(command).inheritIO().start().waitFor()!=0)throw new IllegalStateException("test build transport failed");
    }
}

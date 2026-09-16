package com.project.platform.server;

import java.nio.file.Path;
import java.util.*;

/** Test-only Windows-to-Linux archive transport. The actual validator/importer remains real Skopeo. */
public final class SkopeoTestBridge {
    public static void main(String[] args) throws Exception {
        String tool=args[0];var temporaries=new ArrayList<String>();int code=1;
        var invocation=new ArrayList<>(List.of("docker","exec",tool,"skopeo"));
        try {
            for(int i=1;i<args.length;i++) {
                String value=args[i];
                boolean archive=value.startsWith("docker-archive:");
                boolean credential=i>1 && Set.of("--authfile","--src-authfile","--dest-authfile").contains(args[i-1]);
                if(archive || credential) {
                    String temporary="/tmp/cea-skopeo-test-"+UUID.randomUUID();temporaries.add(temporary);
                    String source=Path.of(archive?value.substring("docker-archive:".length()):value).toAbsolutePath().toString();
                    int copied=new ProcessBuilder("docker","cp",source,tool+":"+temporary).inheritIO().start().waitFor();
                    if(copied!=0)throw new IllegalStateException("test archive transfer failed");
                    value=(archive?"docker-archive:":"")+temporary;
                }
                invocation.add(value);
            }
            code=new ProcessBuilder(invocation).inheritIO().start().waitFor();
        } finally {
            for(String temporary:temporaries)new ProcessBuilder("docker","exec",tool,"rm","-f",temporary).inheritIO().start().waitFor();
        }
        System.exit(code);
    }
}

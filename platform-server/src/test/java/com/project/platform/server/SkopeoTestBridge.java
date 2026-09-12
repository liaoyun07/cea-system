package com.project.platform.server;

import java.nio.file.Path;
import java.util.*;

/** Test-only Windows-to-Linux archive transport. The actual validator/importer remains real Skopeo. */
public final class SkopeoTestBridge {
    public static void main(String[] args) throws Exception {
        String tool=args[0],temporary=null;int code=1;
        var invocation=new ArrayList<>(List.of("docker","exec",tool,"skopeo"));
        try {
            for(int i=1;i<args.length;i++) {
                String value=args[i];
                if(value.startsWith("docker-archive:")) {
                    temporary="/tmp/cea-upload-test-"+UUID.randomUUID()+".tar";
                    String source=Path.of(value.substring("docker-archive:".length())).toAbsolutePath().toString();
                    int copied=new ProcessBuilder("docker","cp",source,tool+":"+temporary).inheritIO().start().waitFor();
                    if(copied!=0)throw new IllegalStateException("test archive transfer failed");
                    value="docker-archive:"+temporary;
                }
                invocation.add(value);
            }
            code=new ProcessBuilder(invocation).inheritIO().start().waitFor();
        } finally {
            if(temporary!=null)new ProcessBuilder("docker","exec",tool,"rm","-f",temporary).inheritIO().start().waitFor();
        }
        System.exit(code);
    }
}

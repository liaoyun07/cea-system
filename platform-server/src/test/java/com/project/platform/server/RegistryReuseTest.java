package com.project.platform.server;

import com.project.platform.deployment.distribution.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RegistryReuseTest {
    @Test void only404MeansMissingAndHeadMustConfirmExactDigest() throws Exception {
        String digest="sha256:"+"a".repeat(64);
        var status=new AtomicInteger(200);var header=new AtomicReference<>(digest);
        var method=new AtomicReference<String>();var path=new AtomicReference<String>();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{
            method.set(exchange.getRequestMethod());path.set(exchange.getRequestURI().getPath());
            if(header.get()!=null)exchange.getResponseHeaders().add("Docker-Content-Digest",header.get());
            exchange.sendResponseHeaders(status.get(),-1);exchange.close();
        });server.start();
        var connection=new RegistryHttpClient.Connection("test","http://127.0.0.1:"+server.getAddress().getPort(),null);
        try(var client=new RegistryHttpClient()) {
            assertTrue(client.hasManifest(connection,"lab/sample",digest));
            assertEquals("HEAD",method.get());assertEquals("/v2/lab/sample/manifests/"+digest,path.get());
            status.set(404);assertFalse(client.hasManifest(connection,"lab/sample",digest));
            for(int code:new int[]{401,403,429,500,502,302,202}) {
                status.set(code);assertThrows(SkopeoImageClient.Failure.class,()->client.hasManifest(connection,"lab/sample",digest));
            }
            status.set(200);
            for(String value:new String[]{null,"sha256:"+"b".repeat(64),"invalid"}) {
                header.set(value);assertThrows(SkopeoImageClient.Failure.class,()->client.hasManifest(connection,"lab/sample",digest));
            }
            server.stop(0);
            assertThrows(SkopeoImageClient.Failure.class,()->client.hasManifest(connection,"lab/sample",digest));
        } finally {server.stop(0);}
    }
}

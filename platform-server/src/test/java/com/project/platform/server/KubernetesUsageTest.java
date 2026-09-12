package com.project.platform.server;

import com.project.platform.resource.kubernetes.KubernetesResourceService;
import io.fabric8.kubernetes.api.model.Quantity;
import java.time.*;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class KubernetesUsageTest {
    @Test void quantityConversionsUseCoresWorkingSetAndActualLimitsWithoutMissingToZero() throws Exception {
        Instant now=Instant.parse("2026-09-12T00:00:00Z");
        var service=new KubernetesResourceService(null,null,Clock.fixed(now,ZoneOffset.UTC));
        var method=KubernetesResourceService.class.getDeclaredMethod("usage",Map.class,Map.class,String.class,io.fabric8.kubernetes.api.model.Duration.class);
        method.setAccessible(true);
        var values=Map.of("cpu",new Quantity("250000000n"),"memory",new Quantity("64Mi"));
        var limits=Map.of("cpu",new Quantity("2"),"memory",new Quantity("128Mi"));
        var window=new io.fabric8.kubernetes.api.model.Duration(Duration.ofSeconds(15));
        var result=(KubernetesResourceService.Usage)method.invoke(service,values,limits,now.toString(),window);
        assertEquals(.25,result.cpuCores());assertEquals(67108864L,result.memoryBytes());assertEquals(12.5,result.cpuPercent());assertEquals(50.,result.memoryPercent());
        assertEquals("PT15S",result.window());
        result=(KubernetesResourceService.Usage)method.invoke(service,values,null,now.toString(),window);
        assertNull(result.cpuPercent());assertNull(result.memoryPercent());
        result=(KubernetesResourceService.Usage)method.invoke(service,Map.of("cpu",new Quantity("0"),"memory",new Quantity("0")),limits,now.toString(),window);
        assertEquals(0.,result.cpuCores());assertEquals(0L,result.memoryBytes());
        result=(KubernetesResourceService.Usage)method.invoke(service,null,limits,now.toString(),window);
        assertEquals("MISSING",result.status());assertNull(result.cpuCores());
        result=(KubernetesResourceService.Usage)method.invoke(service,values,limits,now.plusSeconds(11).toString(),window);
        assertEquals("INVALID",result.status());assertNull(result.cpuCores());
        result=(KubernetesResourceService.Usage)method.invoke(service,values,limits,now.minusSeconds(121).toString(),window);
        assertEquals("STALE",result.status());assertNull(result.cpuCores());
    }
}

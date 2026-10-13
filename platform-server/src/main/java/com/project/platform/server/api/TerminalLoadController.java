package com.project.platform.server.api;

import com.project.platform.edge.TerminalLoad.*;
import com.project.platform.edge.TerminalLoadService;
import com.project.platform.offloading.OffloadingService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.time.Instant;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** Composes read projections through public services; no cross-module SQL. */
@RestController
@RequestMapping("/api/namespaces/{namespace}")
public final class TerminalLoadController {
    private final TerminalLoadService loads;
    private final OffloadingService offloading;
    private final IdentityDirectory identities;
    public TerminalLoadController(TerminalLoadService loads,OffloadingService offloading,IdentityDirectory identities){this.loads=loads;this.offloading=offloading;this.identities=identities;}
    public record Strategy(String strategy) {}
    public record View(Snapshot data,List<OffloadingService.ExecutionTarget> targets) {}
    @GetMapping("/edge/load/profiles")
    public Map<String,Profile> profiles(Principal p,@PathVariable String namespace){return loads.profiles(identities.actor(p.getName()),namespace);}
    @GetMapping("/edge/load/devices")
    public List<Device> devices(Principal p,@PathVariable String namespace){return loads.devices(identities.actor(p.getName()),namespace);}
    @GetMapping("/edge/load/runs")
    public List<Run> runs(Principal p,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset){return loads.runs(identities.actor(p.getName()),namespace,limit,offset);}
    @PostMapping("/edge/load/runs")
    public Run start(Principal p,@PathVariable String namespace,@RequestBody Start request){return loads.start(identities.actor(p.getName()),namespace,request);}
    @PostMapping("/edge/load/runs/{id}/strategy")
    public Run strategy(Principal p,@PathVariable String namespace,@PathVariable String id,@RequestBody Strategy request){return loads.switchStrategy(identities.actor(p.getName()),namespace,id,request.strategy());}
    @PostMapping("/edge/load/runs/{id}/stop")
    public Run stop(Principal p,@PathVariable String namespace,@PathVariable String id){return loads.stop(identities.actor(p.getName()),namespace,id);}
    @GetMapping("/edge/load/runs/{id}")
    public View snapshot(Principal p,@PathVariable String namespace,@PathVariable String id,
                         @RequestParam(required=false) Instant from,@RequestParam(required=false) Instant to) {
        var actor=identities.actor(p.getName());var data=loads.snapshot(actor,namespace,id,from,to);
        var ids=data.requests().stream().map(Request::executionId).filter(Objects::nonNull).distinct().toList();
        return new View(data,offloading.executionTargets(actor,namespace,ids));
    }
    @PostMapping("/edge-access/terminals/{id}/load/resource")
    public Command resource(Principal p,@PathVariable String namespace,@PathVariable String id,@RequestBody Resource resource){return loads.resource(identities.actor(p.getName()),namespace,id,resource);}
    @PostMapping("/edge-access/terminals/{id}/load/requests")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ExecutionController.Accepted compute(Principal p,@PathVariable String namespace,@PathVariable String id,@RequestBody Compute request){
        return new ExecutionController.Accepted(loads.compute(identities.actor(p.getName()),namespace,id,request));
    }
    @PostMapping("/edge-access/terminals/{id}/load/report")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void report(Principal p,@PathVariable String namespace,@PathVariable String id,@RequestBody Report report){loads.report(identities.actor(p.getName()),namespace,id,report);}
}

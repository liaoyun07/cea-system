package com.project.platform.server.api;

import com.project.platform.edge.EdgeAccess.*;
import com.project.platform.edge.EdgeAccessService;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import java.util.Set;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/edge")
public final class EdgeController {
    private final EdgeAccessService edge;
    private final IdentityDirectory identities;
    public EdgeController(EdgeAccessService edge,IdentityDirectory identities) { this.edge=edge;this.identities=identities; }
    @PutMapping("/gateways/{id}")
    public Gateway gateway(Principal p,@PathVariable String namespace,@PathVariable String id,@RequestBody GatewayRegistration request) {
        var account=identities.actor(request.principal());
        if(!account.namespaces().contains(namespace) || !account.actions().equals(Set.of(Action.CONNECT)))
            throw new com.project.platform.foundation.identity.AccessPolicy.Forbidden();
        return edge.putGateway(actor(p),namespace,id,request);
    }
    @GetMapping("/gateways")
    public List<Gateway> gateways(Principal p,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return edge.gateways(actor(p),namespace,limit,offset);
    }
    @PutMapping("/terminals/{id}")
    public Terminal terminal(Principal p,@PathVariable String namespace,@PathVariable String id,@RequestBody TerminalRegistration request) {
        return edge.putTerminal(actor(p),namespace,id,request);
    }
    @GetMapping("/terminals")
    public List<Terminal> terminals(Principal p,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return edge.terminals(actor(p),namespace,limit,offset);
    }
    @PutMapping("/policies/{id}")
    public PolicyView policy(Principal p,@PathVariable String namespace,@PathVariable String id,@RequestBody PolicyRequest request) {
        return edge.putPolicy(actor(p),namespace,id,request);
    }
    @GetMapping("/policies/{id}")
    public PolicyView policy(Principal p,@PathVariable String namespace,@PathVariable String id) { return edge.policy(actor(p),namespace,id); }
    @GetMapping("/policies")
    public List<Policy> policies(Principal p,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return edge.policies(actor(p),namespace,limit,offset);
    }
    private Actor actor(Principal p) { return identities.actor(p.getName()); }
}

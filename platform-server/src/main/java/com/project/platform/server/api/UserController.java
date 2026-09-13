package com.project.platform.server.api;

import com.project.platform.server.security.IdentityDirectory;
import com.project.platform.server.security.IdentityDirectory.*;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}")
public final class UserController {
    private final IdentityDirectory users;
    public UserController(IdentityDirectory users) { this.users=users; }
    @GetMapping("/me")
    public Profile me(Principal principal,@PathVariable String namespace) { return users.profile(principal.getName(),namespace); }
    @PutMapping("/me/password")
    public void password(Principal principal,@PathVariable String namespace,@RequestBody PasswordChange request) { users.changePassword(principal.getName(),namespace,request); }
    @GetMapping("/users")
    public List<Profile> list(Principal principal,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) { return users.list(principal.getName(),namespace,limit,offset); }
    @PostMapping("/users")
    public Profile create(Principal principal,@PathVariable String namespace,@RequestBody Create request) { return users.create(principal.getName(),namespace,request); }
    @PutMapping("/users/{name}")
    public Profile update(Principal principal,@PathVariable String namespace,@PathVariable String name,@RequestBody Update request) { return users.update(principal.getName(),namespace,name,request); }
    @PutMapping("/users/{name}/password")
    public void reset(Principal principal,@PathVariable String namespace,@PathVariable String name,@RequestBody PasswordReset request) { users.resetPassword(principal.getName(),namespace,name,request); }
}

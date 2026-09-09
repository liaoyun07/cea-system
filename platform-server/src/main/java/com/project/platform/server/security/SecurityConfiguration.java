package com.project.platform.server.security;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableConfigurationProperties(SecurityProperties.class)
public class SecurityConfiguration {
    @Bean PasswordEncoder passwordEncoder() { return PasswordEncoderFactories.createDelegatingPasswordEncoder(); }
    @Bean IdentityDirectory identityDirectory(SecurityProperties properties, PasswordEncoder encoder) {
        return new IdentityDirectory(properties, encoder);
    }
    @Bean InMemoryUserDetailsManager users(IdentityDirectory directory) { return new InMemoryUserDetailsManager(directory.users()); }
    @Bean SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
        return http.csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
                .httpBasic(Customizer.withDefaults())
                .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, failure) -> {
                    response.setStatus(401);
                    response.setContentType("application/json");
                    response.getWriter().write("{\"code\":\"UNAUTHENTICATED\",\"message\":\"authentication required\"}");
                }))
                .build();
    }
}


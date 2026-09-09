package com.project.platform.server.configuration;

import com.project.platform.runtime.executor.FlowExecutor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "platform.executor.enabled", havingValue = "true", matchIfMissing = true)
public final class ExecutorPump {
    private static final Logger LOG = LoggerFactory.getLogger(ExecutorPump.class);
    private final FlowExecutor executor;
    public ExecutorPump(FlowExecutor executor) { this.executor = executor; }

    @Scheduled(fixedDelayString = "${platform.executor.poll-delay-ms:250}")
    public void poll() {
        try {
            for (int i = 0; i < 32 && executor.processNext(); i++) { /* bounded transaction batch */ }
        } catch (RuntimeException ex) {
            LOG.error("Execution step rolled back; durable message retained", ex);
        }
    }
}

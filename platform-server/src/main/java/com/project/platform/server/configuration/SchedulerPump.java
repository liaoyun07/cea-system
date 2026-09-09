package com.project.platform.server.configuration;

import com.project.platform.runtime.scheduler.SchedulerEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="platform.scheduler.enabled",havingValue="true",matchIfMissing=true)
public final class SchedulerPump {
    private static final Logger LOG=LoggerFactory.getLogger(SchedulerPump.class);
    private final SchedulerEngine scheduler;
    public SchedulerPump(SchedulerEngine scheduler) { this.scheduler=scheduler; }
    @Scheduled(fixedDelayString="${platform.scheduler.poll-delay-ms:250}")
    public void poll() {
        try { for(int i=0;i<100 && scheduler.runOnce();i++) { } }
        catch(RuntimeException ex) { LOG.error("Scheduler transaction failed; persistent cursor retained",ex); }
    }
}

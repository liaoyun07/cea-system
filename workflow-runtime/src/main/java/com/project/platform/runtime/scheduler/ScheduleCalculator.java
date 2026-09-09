package com.project.platform.runtime.scheduler;

import com.project.platform.runtime.model.FlowDefinition.Schedule;
import com.project.platform.runtime.model.WorkflowException;
import java.time.*;
import org.springframework.scheduling.support.CronExpression;

/** Uses Spring's six-field cron and zone rules; no custom cron parser. */
public final class ScheduleCalculator {
    private ScheduleCalculator() {}
    public static void validate(Schedule schedule) {
        try {
            if(schedule.cron()==null || schedule.cron().trim().split("\\s+").length!=6) throw new IllegalArgumentException();
            CronExpression.parse(schedule.cron()); ZoneId.of(schedule.timezone());
        } catch(RuntimeException ex) { throw WorkflowException.invalid("schedule","six-field cron and valid timezone required"); }
    }
    public static Instant next(Schedule schedule,Instant after) {
        var next=CronExpression.parse(schedule.cron()).next(after.atZone(ZoneId.of(schedule.timezone())));
        return next==null?null:next.toInstant();
    }
}

package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.WorkflowException;
import io.pebbletemplates.pebble.PebbleEngine;
import io.pebbletemplates.pebble.loader.StringLoader;
import java.io.StringWriter;
import java.io.IOException;
import java.util.Map;

public final class TemplateRenderer {
    private final PebbleEngine engine = new PebbleEngine.Builder()
            .loader(new StringLoader()).strictVariables(true).autoEscaping(false)
            .maxRenderedSize(65536).build();

    public void validate(String message) {
        if (message == null || message.length() > 65536) {
            throw WorkflowException.invalid("message", "required and at most 65536 characters");
        }
        // S1 messages are expressions, not executable template programs or file includes.
        if (message.contains("{%")) throw WorkflowException.invalid("message", "template statements are not supported");
        try { engine.getTemplate(message); }
        catch (RuntimeException ex) { throw WorkflowException.invalid("message", "invalid template syntax"); }
    }

    public String render(String message, Map<String, Object> context) {
        try {
            StringWriter writer = new StringWriter();
            engine.getTemplate(message).evaluate(writer, context);
            return writer.toString();
        } catch (IOException | RuntimeException ex) {
            throw WorkflowException.invalid("message", "template evaluation failed (unknown reference or invalid expression)");
        }
    }
}


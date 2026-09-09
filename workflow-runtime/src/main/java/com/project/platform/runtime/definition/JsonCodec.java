package com.project.platform.runtime.definition;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;
import com.project.platform.runtime.model.FlowDefinition;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;

public final class JsonCodec {
    private final JsonMapper mapper = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS).build();

    public String write(Object value) { return mapper.writeValueAsString(value); }
    public <T> T read(String value, Class<T> type) { return mapper.readValue(value, type); }
    @SuppressWarnings("unchecked")
    public Map<String, Object> map(String value) {
        return mapper.readValue(value, Map.class);
    }
    public FlowDefinition flow(String value) { return read(value, FlowDefinition.class); }
    public String hash(Object value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(write(value).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is required by the Java runtime", ex);
        }
    }
}


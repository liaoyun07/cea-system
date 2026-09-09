package com.project.platform.resource.catalog;

import java.util.List;

/** Declared resources, not observed health or reservations. Namespace is supplied by the authorized route. */
public final class ResourceCatalog {
    private ResourceCatalog() {}
    public enum Kind { CLOUD, EDGE }
    public record Cluster(String id, Kind kind, Boolean enabled) {
        public Cluster { enabled=enabled==null || enabled; }
    }
    public record Location(String clusterId, String uri) {}
    public record DatasetVersion(String datasetId, String version, String format, List<Location> locations) {
        public DatasetVersion { locations=locations==null?List.of():List.copyOf(locations); }
    }
    public record DatasetRequirement(String datasetId, String version, String requiredFormat) {}
    public record PlacementRequest(List<String> candidateClusterIds, List<DatasetRequirement> datasets) {
        public PlacementRequest {
            candidateClusterIds=candidateClusterIds==null?List.of():List.copyOf(candidateClusterIds);
            datasets=datasets==null?List.of():List.copyOf(datasets);
        }
    }
    public record DatasetLocation(String datasetId, String version, String format, String uri) {}
    public record PlacementOption(String clusterId, Kind kind, boolean eligible, List<String> reasons, List<DatasetLocation> datasets) {}
}

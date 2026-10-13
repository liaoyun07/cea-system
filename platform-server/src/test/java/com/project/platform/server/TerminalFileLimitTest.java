package com.project.platform.server;

import com.project.platform.dataflow.execution.TerminalGatewayClient.LocalFile;
import com.project.platform.runtime.model.WorkflowException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TerminalFileLimitTest {
    @Test void supportsLargeTerminalFilesWithoutAnUnboundedProtocol() {
        String id="af2ed213-d023-4d40-9d3a-bff55b633a91";
        for(long bytes:new long[]{5_000_000,50_000_000,500_000_000,1_073_741_824})
            assertEquals(bytes,new LocalFile(id,bytes).bytes());
        for(long bytes:new long[]{0,-1,1_073_741_825})
            assertThrows(WorkflowException.class,()->new LocalFile(id,bytes));
        assertThrows(WorkflowException.class,()->new LocalFile("../data",5_000_000));
    }
}

# S3构建输入SHA256清单

关联[VER-S3-001](VER-S3-001-control-scheduling.md)。2026-09-09，75项统一测试通过后的构建输入快照。backend独立仓库尚无提交号，本清单用于定位验收源码，不是新增业务hash字段。

范围：POM、生产/测试Java、SQL与配置、示例、验证脚本和OpenAPI，共70份。排除target、.git、凭据、文档叙述及本清单。相对S2快照：新增8份、修改20份、删除SequentialExecutor.java一份；其中FlowExecutor替换旧执行器。S2清单保留作为历史证据。

| 相对backend路径 | SHA256 |
|---|---|
| `docs/contracts/openapi.json` | `2f00ba69a234500e9bf8a6dfb23bff70fc6f279a58a72dc13e3c94020e026a68` |
| `examples/s1-log-flow.yaml` | `179be38b69d2db6ed8662570a96784c10617085c653c55a47d2468ed55ab9365` |
| `examples/s2-retry-cleanup.yaml` | `7d923de245167450bc7e0f9f2968ee39ecacc874f333d3df0ec09e42fbae3835` |
| `examples/s3-control-flow.yaml` | `3f94de998c96c73d042ed83e7ab98cd0161eab99118e1a23e258c82357e09e32` |
| `platform-dataflow/pom.xml` | `4930aa53635a319fcaa57e1f60f68944a708dcbf66e61ba3d52f803f12d10c39` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowRevision.java` | `b66d0e43d4a03523698d651cc990eee725dc8d84f7b45ff81faabe588ca7fd2a` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowService.java` | `0a2dbf1c2831fb19ee09e6719b46d86aa2ed5660c18aec1ed038b44fd13ee5af` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/JdbcFlowRepository.java` | `c39d6c7550ddc06f0dc90579c20930fdbd4b8db398da02b7c67700cd52291e99` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/execution/FlowExecutionService.java` | `91f8721a0d9426c7a0d9f8aae4c9c4b383d1af9c1046382af78e4ef57c704a23` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/package-info.java` | `45d367373d7b31ec06fbff34632fdf756afbaa267c0aaa7adf88ad079194d5f3` |
| `platform-dataflow/src/main/resources/db/migration/dataflow/V2__flow_revisions.sql` | `d70bef8b5bd2b8f3a6d5fea311bad8582c18ea737e0263a6d56b4bc2c7a37fa8` |
| `platform-dataflow/src/main/resources/db/migration/dataflow/V4__remove_unused_revision_checksum.sql` | `ecce8aaaac32edfd859021490cefa7c881506e311542ed70c8b1e1f2a1b7dbe2` |
| `platform-deployment/pom.xml` | `153be309623a17bbf984b65feada740b99471d7e2ae251bd95b47b9a272049a6` |
| `platform-deployment/src/main/java/com/project/platform/deployment/package-info.java` | `012850938431b7389cb291d234467c7352be00962afac764145f34b7dbe17e3c` |
| `platform-edge/pom.xml` | `5ae783a4ac4b33cc1ef999db77b1d1d20c064e7dc6812cb31ed639a3b2df2f90` |
| `platform-edge/src/main/java/com/project/platform/edge/package-info.java` | `a951c0aec46f10a487fa355c5b18bb38ff82c6e7b113041ebe30936ed702dbf1` |
| `platform-foundation/pom.xml` | `36365f169e2d2b2ff4e347a71f1a7c461daef52bd8435f0362885e1b13d6f7de` |
| `platform-foundation/src/main/java/com/project/platform/foundation/identity/AccessPolicy.java` | `37a2c6353a0a89611d5b47ac77f36b949db48068b7f600e04f6c368345f99c17` |
| `platform-foundation/src/main/java/com/project/platform/foundation/package-info.java` | `cb8b4de34f47d2750964e636dcedd52f2c04b70752ce2b869ce3c8a3361f8b17` |
| `platform-offloading/pom.xml` | `4a3c4aa004d37ce03354a1e60a45c171fadc892ae2f9fbb58f44ce1c0a63f1ce` |
| `platform-offloading/src/main/java/com/project/platform/offloading/package-info.java` | `4caa9a9e1d5b02008a1e81532f944046d4d2ee831961c0ca3fafbf759b7e7a28` |
| `platform-resource/pom.xml` | `a106179a8f56317198b7e4d18e93e3e0b91dc81ff7e20ff6145c1e012811101d` |
| `platform-resource/src/main/java/com/project/platform/resource/package-info.java` | `6055c09616e3d5c1bc650e3d38e1383ae179c83f0878ca62f202eb034c890125` |
| `platform-server/pom.xml` | `873bcb48a1e2c2c8bd73fa90d15b5281355b22e61d05aee345912dcf79d96e2e` |
| `platform-server/src/main/java/com/project/platform/server/api/ApiExceptionHandler.java` | `ca4b341248a908d71443c5a5f258041955584a84a71af2c1f87f722f8143cd1c` |
| `platform-server/src/main/java/com/project/platform/server/api/ExecutionController.java` | `c1a3e72f7c2118c0899880be134176be91374c15b153dc49c4b370979253f189` |
| `platform-server/src/main/java/com/project/platform/server/api/FlowController.java` | `ea969e76e9bec07128fcfcbcab76c25461f8cf1e8ae6e23bd68cbe42ed37e7bf` |
| `platform-server/src/main/java/com/project/platform/server/BackendApplication.java` | `47ddbb3681c659c362971eddc2e96fde32e01af651a52e0386d7b87916fec38c` |
| `platform-server/src/main/java/com/project/platform/server/configuration/ExecutorPump.java` | `c3645b77a200583b5628bfded25af8719173ad11e68ea8b4354f0f3fb6230c69` |
| `platform-server/src/main/java/com/project/platform/server/configuration/RuntimeConfiguration.java` | `622333c90c2f9052b438466a49816f46241f224fe1a7ab93b69a7ec78b89f7be` |
| `platform-server/src/main/java/com/project/platform/server/configuration/SchedulerPump.java` | `4461fd9182ff68c371e36a815190e361525f4ad198da82aa95bfaef2cfd47b8c` |
| `platform-server/src/main/java/com/project/platform/server/configuration/WorkerPump.java` | `2b7825afa2651e9da328abcc00f36eab89e5bdda87793e037919ef846dd32992` |
| `platform-server/src/main/java/com/project/platform/server/package-info.java` | `f1c6b30800a3abcb71aaf9846661bf3df96fdbb2a639c8049a107deb8b800192` |
| `platform-server/src/main/java/com/project/platform/server/security/IdentityDirectory.java` | `6683c8ca835111696739311bf4f7979e1738d25d8ae4f12388811e12c95715f1` |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityConfiguration.java` | `91f90b52d9734da909dfc447ef12472f05792ae8c79ffbc6a57e69a78ee0518c` |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityProperties.java` | `78e4f6eb9fd1486aac9e24072a25e8e77f182a42982b50eedc0019fc2acf306c` |
| `platform-server/src/main/resources/application.properties` | `344db4dad410f66c3f7fd43eaf378d096aeae38a3a54ff7b56a280635b78ec5a` |
| `platform-server/src/test/java/com/project/platform/server/ArchitectureTest.java` | `9d1f956147fbadb8cfedb1a31ef55be3a9d3820a57e0a621ebf86c20ff4a6d68` |
| `platform-server/src/test/java/com/project/platform/server/ContractTest.java` | `cb363064220f2dd587a9898da53c4e14b42ed0dcf0d619f4f5acc79ac2810b60` |
| `platform-server/src/test/java/com/project/platform/server/DurableWorkflowTest.java` | `45052ca5086afe5ff4da73616701fd35402bf1d01432e3daa918a516bd7e8e99` |
| `pom.xml` | `8787bb9fe38d61bfe7abd2666e88254dc90e26f5f5ecd0bd002385d5c0244e5c` |
| `scripts/check-scaffold.ps1` | `d2bfbfa11e53135c7c9635cb4dd02084fefd1b5e47727b4064095667dafb4962` |
| `scripts/verify.ps1` | `9ce6a93f64e9714e948466ad4fe44cdaf128a4276e6d985f1cba36bb3f18c759` |
| `workflow-runtime/pom.xml` | `592123ea4d7c37c2bbb49ae25b0e78376d974d6bcf5f926b839fc76355a38f53` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/BindingResolver.java` | `488b468ed9f66d0f805e0da0cee6b0b1476d8acbf8957a7fa145745d6891d09c` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowParser.java` | `641f1f2c74499e24cc6f28aafad79abfbd724fe6027a53210a3770727f27f936` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowValidator.java` | `1835bf8e804fa05c7263c7c98cefb49c7b0486f7c0199f273c1cde1ff2b21588` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/JsonCodec.java` | `728040a5a1cfc434df859ebb694067e9afc3aefca0e88b21a5a96aff134c224b` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/TemplateRenderer.java` | `3f860a62d3c4eab78377d34d80fdbfef28f4c59fe8363a7cc1d5f6977357dd7e` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/execution/ExecutionService.java` | `491fc9abf64d51cc99546f259423dd77455cf5681b485f19feefdb6be73eb16f` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/ExecutionReducer.java` | `7e273db73d2030c8a37c14dd37e35898123678fa5f690ff21b7991735a5c1d2d` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/FlowExecutor.java` | `0d36ead81fbd562a15adb415f1bed90a0e15f11d9008a73a46f513d12f6ce492` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionRecord.java` | `ad30d4bae609ab1a75d1c002ff3b97b1bd8f984d97c6a40fdae1ed67056f0e0d` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionState.java` | `c60e343e93e8227a570052b027a46498dec7a8cdbf51d9659f744275c1a31769` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/FlowDefinition.java` | `9f535eed605d022cdbb11c35ad4ab1cf55beda1d345f0138b86b429695b2047a` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/WorkflowException.java` | `0e2a8d7fd0c2605907a20456ee2e1a3ca9fc9114e2e4d7fe00c749aa0d13da5d` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/package-info.java` | `9ae6f4b5bd74fbfde2b8e7e056fa413c75cd59bc50b1a6b9ac38e1b7177f057a` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcExecutionStore.java` | `fa9346caebb0f8629d94b9a9e3e42167ff46baf680efae50ec20dea05d2ae3ff` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcScheduleStore.java` | `8a0c226870bd08697ff071ce54ca212074cf9620542f7c015eea3f5d3063cc0a` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcWorkerStore.java` | `bba61882cfa1167e12b27fc8454c5316aad6a5b4f17d93ff0b6ff9ec6c24919c` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/scheduler/ScheduleCalculator.java` | `e439b4abc0a0539aa0343c197317b3b6e8f0539ef54fc6101a2997559c67b673` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/scheduler/SchedulerEngine.java` | `e0ee032afba2f308b5c1a5ebb314d294421cf3b3e44bccf1a4759a31020bd513` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerEngine.java` | `f03c0be168b3cb71d8de419fcc2bd7d740167a8da0b641de67c517ae3ee15a5c` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerJob.java` | `73addd54dd4084366f1dc8ee2a65d1e73754da133fb8047a5965de767bf4e849` |
| `workflow-runtime/src/main/resources/db/migration/runtime/V1__runtime.sql` | `f9a490672c70dd92d93f415e788b72b5937dfbc156d16ab7427d2bebd43d9f5f` |
| `workflow-runtime/src/main/resources/db/migration/runtime/V3__worker_lifecycle.sql` | `0bc9c8d5a5d4061596061323e75152d65bd92e17ee91529af7e35b6bffdd4829` |
| `workflow-runtime/src/main/resources/db/migration/runtime/V5__control_flow_and_scheduling.sql` | `dde70c940b19a9e76f4644b67f7935b535bdeeee1f4dd4264a8b6a31e125245a` |
| `workflow-runtime/src/test/java/com/project/platform/runtime/definition/ControlFlowTest.java` | `8d26b68d036482032c124f982237a79077eaa29bf0621c0b1a3ceaec06b4a571` |
| `workflow-runtime/src/test/java/com/project/platform/runtime/definition/DefinitionTest.java` | `d0861b44d279df51dd7398dea3016f38fb71f39644df0c6d04f6529c6e76ff27` |
| `workflow-runtime/src/test/java/com/project/platform/runtime/definition/LifecycleTest.java` | `3ed817c4bdf4c080e93c4f29bd9dd5b6669c21042cb3735a8b47a89efea76c89` |

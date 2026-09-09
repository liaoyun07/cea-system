# S2构建输入SHA256清单

关联[VER-S2-001](VER-S2-001-worker-lifecycle.md)。2026-09-09生成，48项测试通过后的构建输入快照；无有效Git提交号时用于定位证据。源码未修改系统旧工程。

范围：POM、生产/测试Java、SQL与配置、示例、验证脚本和OpenAPI，共63份。排除target、凭据、工具缓存、历史验证清单及本文件；文档叙述不计入构建输入。OpenAPI最后只修正旧attempt描述文字，Java/SQL与测试未再改变。

| 相对backend路径 | SHA256 |
|---|---|
| `docs/contracts/openapi.json` | `1dd88fe7d9fedc5fef81765992b4f81c39980e33b2c92746e8c41f6214af7879` |
| `examples/s1-log-flow.yaml` | `179be38b69d2db6ed8662570a96784c10617085c653c55a47d2468ed55ab9365` |
| `examples/s2-retry-cleanup.yaml` | `7d923de245167450bc7e0f9f2968ee39ecacc874f333d3df0ec09e42fbae3835` |
| `platform-dataflow/pom.xml` | `4930aa53635a319fcaa57e1f60f68944a708dcbf66e61ba3d52f803f12d10c39` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowRevision.java` | `b66d0e43d4a03523698d651cc990eee725dc8d84f7b45ff81faabe588ca7fd2a` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/FlowService.java` | `4cf1910859e821eca58c3a35d975a34255ebc25750b28caaa72d30d25733d023` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/definition/JdbcFlowRepository.java` | `c39d6c7550ddc06f0dc90579c20930fdbd4b8db398da02b7c67700cd52291e99` |
| `platform-dataflow/src/main/java/com/project/platform/dataflow/execution/FlowExecutionService.java` | `21b6753e1c94b855e9b5e53179bdffcca9afb44da119d0f7fbf9acaefb72d4ba` |
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
| `platform-server/src/main/java/com/project/platform/server/configuration/ExecutorPump.java` | `bbbf9e011c9548ef3f6d219c2699ebdbeabf3c95be57c6cd9ce021b2fd756f88` |
| `platform-server/src/main/java/com/project/platform/server/configuration/RuntimeConfiguration.java` | `56330d158d9c3af279cd6c792ce952a82dc89776baca997e05a08864d74d4f13` |
| `platform-server/src/main/java/com/project/platform/server/configuration/WorkerPump.java` | `40c62c4462e75d85d45eb039cae9f851ef8490561da9acfcfdf28fa6ee267ceb` |
| `platform-server/src/main/java/com/project/platform/server/package-info.java` | `f1c6b30800a3abcb71aaf9846661bf3df96fdbb2a639c8049a107deb8b800192` |
| `platform-server/src/main/java/com/project/platform/server/security/IdentityDirectory.java` | `6683c8ca835111696739311bf4f7979e1738d25d8ae4f12388811e12c95715f1` |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityConfiguration.java` | `91f90b52d9734da909dfc447ef12472f05792ae8c79ffbc6a57e69a78ee0518c` |
| `platform-server/src/main/java/com/project/platform/server/security/SecurityProperties.java` | `78e4f6eb9fd1486aac9e24072a25e8e77f182a42982b50eedc0019fc2acf306c` |
| `platform-server/src/main/resources/application.properties` | `856fe5757774c0f452f8bb8821fd3e4b6b63daa960f87b1478bc20f40b6bc44c` |
| `platform-server/src/test/java/com/project/platform/server/ArchitectureTest.java` | `9d1f956147fbadb8cfedb1a31ef55be3a9d3820a57e0a621ebf86c20ff4a6d68` |
| `platform-server/src/test/java/com/project/platform/server/ContractTest.java` | `99bc747f90bc5b2dace491570103f6e3917b01b6fd75fa7b17a4b1911bf33f86` |
| `platform-server/src/test/java/com/project/platform/server/DurableWorkflowTest.java` | `939159e1d3ae8d8ee989c9593bfd0afdc97ddd257d514ac2f723ff2622e4f2ba` |
| `pom.xml` | `8787bb9fe38d61bfe7abd2666e88254dc90e26f5f5ecd0bd002385d5c0244e5c` |
| `scripts/check-scaffold.ps1` | `d2bfbfa11e53135c7c9635cb4dd02084fefd1b5e47727b4064095667dafb4962` |
| `scripts/verify.ps1` | `4d3ff49c7f551b96e18ee21a68756a37ca9a06a378813cdc131a035316e06c55` |
| `workflow-runtime/pom.xml` | `f10cf84492f0f4ddf62006615adc3d5efaa49fab04b96a7b48fad61320477b8b` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/BindingResolver.java` | `488b468ed9f66d0f805e0da0cee6b0b1476d8acbf8957a7fa145745d6891d09c` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowParser.java` | `641f1f2c74499e24cc6f28aafad79abfbd724fe6027a53210a3770727f27f936` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/FlowValidator.java` | `8ee7d56323a5dfd2fe6ece62f0b018cc2c1b0b48227c25297924a95f95455b47` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/JsonCodec.java` | `728040a5a1cfc434df859ebb694067e9afc3aefca0e88b21a5a96aff134c224b` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/definition/TemplateRenderer.java` | `3f860a62d3c4eab78377d34d80fdbfef28f4c59fe8363a7cc1d5f6977357dd7e` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/execution/ExecutionService.java` | `0460c754de7ab1d9aae6ac58e0d77c8aa9ae6f6182d4292513da76998f274755` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/ExecutionReducer.java` | `463c0228716b3d46d8ed1bc72a763aa65f9367847a4386461de874b87cefd1f2` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/executor/SequentialExecutor.java` | `af6639e21aba7aa4186fba9012c73df29726a55a0343fb4a023fadecb57456ff` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionRecord.java` | `d33095467344dbf13d4e070ba32ee2794c8581632ee9c3f611353e84c5a70d0b` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/ExecutionState.java` | `993fdb93be42905df8347ebcca8eb97ba89575cc44181e32f3eae534771ee24d` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/FlowDefinition.java` | `14057834caef9daaa514bde803c959ea011da7032a5462a1afddcf0d6f1a8d73` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/model/WorkflowException.java` | `0e2a8d7fd0c2605907a20456ee2e1a3ca9fc9114e2e4d7fe00c749aa0d13da5d` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/package-info.java` | `9ae6f4b5bd74fbfde2b8e7e056fa413c75cd59bc50b1a6b9ac38e1b7177f057a` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcExecutionStore.java` | `df7be32525e8538b0f9526a077f427d8c13889c1a6352e6d2938c531d13c5a54` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/persistence/JdbcWorkerStore.java` | `bba61882cfa1167e12b27fc8454c5316aad6a5b4f17d93ff0b6ff9ec6c24919c` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerEngine.java` | `f03c0be168b3cb71d8de419fcc2bd7d740167a8da0b641de67c517ae3ee15a5c` |
| `workflow-runtime/src/main/java/com/project/platform/runtime/worker/WorkerJob.java` | `73addd54dd4084366f1dc8ee2a65d1e73754da133fb8047a5965de767bf4e849` |
| `workflow-runtime/src/main/resources/db/migration/runtime/V1__runtime.sql` | `f9a490672c70dd92d93f415e788b72b5937dfbc156d16ab7427d2bebd43d9f5f` |
| `workflow-runtime/src/main/resources/db/migration/runtime/V3__worker_lifecycle.sql` | `0bc9c8d5a5d4061596061323e75152d65bd92e17ee91529af7e35b6bffdd4829` |
| `workflow-runtime/src/test/java/com/project/platform/runtime/definition/DefinitionTest.java` | `afd279818fa8a170be7040d6b58399c8d95442b7cf98f7850fcbdb10fa439512` |
| `workflow-runtime/src/test/java/com/project/platform/runtime/definition/LifecycleTest.java` | `83eef307b5bb893252db1133bc4b65827bc2284ffd0725fdcc14173427cc17cd` |

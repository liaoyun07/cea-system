package com.project.platform.server;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

class ArchitectureTest {
    @Test void modulesDoNotCycleAndCoreModelHasNoInfrastructureDependencies() {
        var classes = new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.project.platform");
        slices().matching("com.project.platform.(*)..").should().beFreeOfCycles().check(classes);
        noClasses().that().resideInAPackage("com.project.platform.runtime..").should()
                .dependOnClassesThat().resideInAnyPackage("com.project.platform.dataflow..",
                        "com.project.platform.server..","com.project.platform.offloading..",
                        "com.project.platform.foundation..","com.project.platform.resource..","com.project.platform.edge..","com.project.platform.deployment..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.edge..").should()
                .dependOnClassesThat().resideInAnyPackage("com.project.platform.runtime.persistence..","com.project.platform.server..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.edge..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.dataflow.definition.JdbcFlowRepository").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.edge..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.resource.catalog.JdbcResourceRepository").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.runtime.model..").should()
                .dependOnClassesThat().resideInAnyPackage("org.springframework..","java.sql..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.server.api..").should()
                .dependOnClassesThat().resideInAnyPackage("org.springframework.jdbc..",
                        "com.project.platform.runtime.persistence..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.server.api..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.resource.catalog.JdbcResourceRepository").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.resource..").should()
                .dependOnClassesThat().resideInAnyPackage("com.project.platform.runtime..","com.project.platform.dataflow..","com.project.platform.deployment..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.deployment..").should()
                .dependOnClassesThat().resideInAnyPackage("com.project.platform.runtime..","com.project.platform.dataflow..").check(classes);
        noClasses().that().resideInAnyPackage("com.project.platform.server.api..","com.project.platform.dataflow..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.deployment.application.JdbcApplicationRepository").check(classes);
        for(String repository:java.util.List.of("distribution.JdbcImageDistributionRepository","service.JdbcDeploymentRecordRepository"))
            noClasses().that().resideInAnyPackage("com.project.platform.server.api..","com.project.platform.dataflow..","com.project.platform.edge..","com.project.platform.resource..").should()
                    .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.deployment."+repository).check(classes);
        noClasses().that().resideInAPackage("com.project.platform.deployment..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.resource.catalog.JdbcResourceRepository").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.runtime.worker..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.runtime.persistence.JdbcExecutionStore").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.offloading..").should()
                .dependOnClassesThat().resideInAnyPackage("com.project.platform.runtime.persistence..","com.project.platform.edge..","com.project.platform.dataflow..").check(classes);
        noClasses().that().resideInAnyPackage("com.project.platform.dataflow..","com.project.platform.server.api..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.offloading.JdbcOffloadingRepository").check(classes);
    }
}

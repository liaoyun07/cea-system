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
                        "com.project.platform.foundation..","com.project.platform.resource..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.runtime.model..").should()
                .dependOnClassesThat().resideInAnyPackage("org.springframework..","java.sql..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.server.api..").should()
                .dependOnClassesThat().resideInAnyPackage("org.springframework.jdbc..",
                        "com.project.platform.runtime.persistence..").check(classes);
        noClasses().that().resideInAPackage("com.project.platform.runtime.worker..").should()
                .dependOnClassesThat().haveFullyQualifiedName("com.project.platform.runtime.persistence.JdbcExecutionStore").check(classes);
    }
}

CREATE TABLE df_namespace_file (
    namespace VARCHAR(100) NOT NULL,
    path VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    revision INT NOT NULL,
    content MEDIUMTEXT NOT NULL,
    PRIMARY KEY(namespace,path,revision)
);

CREATE TABLE sec_user (
    name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL,
    enabled BOOLEAN NOT NULL,
    namespaces_json JSON NOT NULL,
    actions_json JSON NOT NULL
);

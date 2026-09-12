FROM eclipse-temurin:21-jre-jammy AS java
FROM quay.io/skopeo/stable:v1.20.0
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:$PATH
RUN microdnf install -y --setopt=install_weak_deps=0 httpd-tools && microdnf clean all \
    && useradd --uid 10001 --create-home cea \
    && mkdir -p /var/lib/cea/uploads/multipart /var/lib/cea/uploads/import \
    && chown -R cea:cea /var/lib/cea/uploads \
    && java -version \
    && skopeo inspect --help | grep -- --no-tags \
    && skopeo copy --help | grep -- --preserve-digests
WORKDIR /app
COPY platform-server/target/platform-server-0.1.0-SNAPSHOT.jar /app/backend.jar
USER cea
EXPOSE 18085
ENTRYPOINT ["java", "-jar", "/app/backend.jar"]
CMD []

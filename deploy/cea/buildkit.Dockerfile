FROM moby/buildkit:v0.33.0-rootless
USER root
RUN mkdir -p /run/cea-buildkit && chown 1000:1000 /run/cea-buildkit
USER 1000:1000

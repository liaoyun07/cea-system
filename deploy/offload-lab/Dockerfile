FROM python:3.11.15-slim AS worker
WORKDIR /app
COPY deploy/terminal-load/matrix/app.py /app/app.py
COPY deploy/offload-lab/worker.py /app/worker.py
RUN mkdir /work && chmod 777 /work
USER 65532:65532
CMD ["python", "-B", "/app/worker.py"]

FROM python:3.11.15-slim AS runtime
WORKDIR /app
RUN pip install --no-cache-dir docker==7.1.0 minio==7.2.18 'PyMySQL[rsa]==1.1.1' requests==2.32.3 PyYAML==6.0.2
COPY deploy/offload-lab/*.py /app/
COPY deploy/terminal-agent/load.py /app/legacy_load.py
COPY deploy/terminal-agent/compute.py /app/compute.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "-B", "/app/server.py"]

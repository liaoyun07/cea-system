FROM python:3.11.15-slim AS compiler
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev
COPY examples/hydraulic-cloud-edge/stats.c /src/stats.c
RUN gcc -O3 -fopenmp-simd -fno-math-errno -ffp-contract=off -shared -fPIC /src/stats.c -lm -o /src/libhydraulic_stats.so

FROM python:3.11.15-slim
RUN pip install --no-cache-dir numpy==1.26.4
WORKDIR /app
COPY examples/hydraulic-cloud-edge/app.py examples/hydraulic-cloud-edge/prepare.py examples/hydraulic-cloud-edge/test_app.py ./
COPY examples/hydraulic-cloud-edge/native_stats.py ./
COPY --from=compiler /src/libhydraulic_stats.so ./
COPY sdk/python/cea_measurement.py ./
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
CMD ["python", "/app/app.py", "edge"]

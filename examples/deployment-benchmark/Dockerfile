FROM python:3.11.15-slim@sha256:ae52c5bef62a6bdd42cd1e8dffef86b9cd284bde9427da79839de7a4b983e7ca AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
WORKDIR /app
COPY examples/deployment-benchmark/server.py /app/server.py
EXPOSE 8080
CMD ["python", "/app/server.py"]

FROM base AS small
COPY examples/offloading/app.py /app/signal_algorithm.py
ENV SERVICE_KIND=signal
USER 10001:10001

FROM base AS scientific
RUN pip install --no-cache-dir numpy==1.26.4 scipy==1.13.1
COPY examples/edge-processing/app.py /app/edge_algorithm.py

FROM scientific AS medium
RUN pip install --no-cache-dir scikit-learn==1.5.2 joblib==1.4.2 threadpoolctl==3.5.0
COPY --from=models bearing.joblib /app/model.joblib
ENV SERVICE_KIND=bearing
USER 10001:10001

FROM scientific AS large
RUN pip install --no-cache-dir pillow==10.4.0 \
 && pip install --no-cache-dir torch==2.2.2+cpu torchvision==0.17.2+cpu --index-url https://download.pytorch.org/whl/cpu
COPY --from=models tile.pt /app/model.pt
ENV SERVICE_KIND=surface
USER 10001:10001

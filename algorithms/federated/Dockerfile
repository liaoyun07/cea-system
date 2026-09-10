FROM python:3.11.15-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=1
WORKDIR /app
RUN pip install --no-cache-dir numpy==1.26.4 && \
    pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.2.2+cpu
COPY model.py app.py seed.py test_federated.py verify_run.py /app/
CMD ["python", "/app/app.py", "--help"]

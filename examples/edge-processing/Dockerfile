# Same reproducible CPU torch baseline as the existing federated tasks, no platform SDK.
FROM python:3.11.15-slim
RUN pip install --no-cache-dir numpy==1.26.4 scipy==1.13.1 scikit-learn==1.5.2 pillow==10.4.0 \
 && pip install --no-cache-dir torch==2.2.2+cpu torchvision==0.17.2+cpu --index-url https://download.pytorch.org/whl/cpu
WORKDIR /app
COPY app.py prepare.py ./
ENV OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "/app/app.py", "hydraulic"]

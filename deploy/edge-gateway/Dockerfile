FROM python:3.11.15-slim
RUN pip install --no-cache-dir boto3==1.35.99
WORKDIR /app
COPY gateway.py terminal.py ./
USER 65532:65532
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
CMD ["python", "/app/gateway.py"]

FROM python:3.11.15-slim
WORKDIR /app
COPY examples/offloading/app.py ./
COPY sdk/python/cea_measurement.py ./
USER 65532:65532
CMD ["python", "/app/app.py"]

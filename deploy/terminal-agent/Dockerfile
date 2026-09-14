FROM python:3.11.15-slim
RUN pip install --no-cache-dir docker==7.1.0
WORKDIR /app
COPY agent.py compute.py ./
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
CMD ["python", "/app/agent.py"]

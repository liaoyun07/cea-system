FROM golang:1.24-alpine AS meter
WORKDIR /src
COPY meter/ ./
RUN go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /resource-meter .

FROM python:3.11-slim
COPY --from=meter /resource-meter /app/resource-meter
COPY transfer.py /app/transfer.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "/app/transfer.py"]

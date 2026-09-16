FROM cea/federated-aggregate:par16-v1
ENV OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
COPY linear_app.py /app/linear_app.py
CMD ["python", "/app/linear_app.py", "--help"]

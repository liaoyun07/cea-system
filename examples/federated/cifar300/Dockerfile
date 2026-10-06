FROM cea/federated:cifar-part-v1
COPY algorithms/federated/model.py algorithms/federated/lenet.py /app/
COPY examples/federated/cifar300/enable_lenet.py /app/enable_lenet.py
RUN python /app/enable_lenet.py

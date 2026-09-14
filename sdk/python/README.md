# 算法镜像公共计量包

将 `cea_measurement.py` 放进算法镜像的Python模块路径，不需要pip安装、公共父镜像或平台凭据。

```python
from pathlib import Path
from cea_measurement import Measurement, REPORT_NAME

with Measurement(Path('/cea-work/out') / REPORT_NAME) as measurement:
    with measurement.input('/cea-work/in/data') as source:
        data = source.read_bytes()  # 算法原本的全文件加载，不是为计量再读一次
    result = process(data)
    destination = Path('/cea-work/out/result.bin')
    destination.write_bytes(result)
    measurement.output(destination)  # 写入已关闭
```

Flow把`cea-measurement.json`加入已有`outputFiles`即可复用文件发布链。目录、局部读取、流式网络输入不是当前全文件协议支持范围；不能把未读取的整个文件算作处理量。模型和数据集也需在真实加载处登记。不在batch/epoch内重复登记放大数字。

报告原子发布为0644，供不同UID的文件助手读取；只包含路径、大小、时点，不能写入凭据。SDK不是从任意镜像自动探测算法输入的工具，接入者仍需在真实读入/写出的位置各加一处登记。

单元测试：`python -B -m unittest -v test_measurement`。
开销小测：`python -B benchmark_metadata.py`，仅测元数据/报告开销，不代表业务算法速率，也不会上报这些合成报告。

具体口径、时钟要求及后端处理见[协议](../../docs/contracts/algorithm-measurement.md)。

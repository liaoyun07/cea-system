# 液压常驻实验的大输入协议（HC-17）

## HC-19 中心计算并发

HC-19沿用原输入、特征和结果协议，只取消中心`add_part`收齐三路后的计算信号量。各批输入独立，公共参考只读，融合/摘要在共享状态锁外并行；登记三路、拒绝重复、结果发布/领取和计数仍在短状态锁内，完整parts保留至成功发布，失败不发布且保留parts。最后一路HTTP仍等本批融合/发布后返回成功；不会提前应答或跳过结果核验。不涉及Java、数据库或普通流任务。

中心`stages.queue=0`表示没有应用层计算信号量等待，并不表示没有线程/CPU调度等待或端到端时延。`stages.compute`仍为每次融合调用的墙钟耗时累加，多批并行时这些区间可能重叠，不能当作CPU时间或全部关键路径耗时相加。边缘计算信号量及其queue统计不变。HC17/18历史语义保留在对应实验记录中。

## 范围与兼容

仅隔离液压常驻实验的 `POST /process/{run}/{batch}` 增加输入格式：

```text
Content-Type: application/vnd.cea.hydraulic-arrays
Content-Length: 完整请求体字节数
```

服务按上述 Content-Type 的精确值选择新解码器；旧 `application/octet-stream` 或未携带该类型的 `/process` 继续使用 NPZ。`POST /partial/{run}/{batch}` 的边缘特征、`GET /binary/{run}/{batch}` 的融合结果及离线 `*-expected.npz` 均仍使用 NPZ；`/result` 的 JSON 摘要不变。

这是实验应用内部的输入表示优化，不是通用 K3s、Job 或流任务能力。原始信号值、周期、通道、统计/融合算法、计算槽和中心锁均不变，不据此预先认定性能提升。

HC-18后续变更不改上述输入协议：中心融合和摘要计算移出共享状态锁，计算仍由单个信号量串行。完整三路特征保留在parts直至原子发布结果，期间重复组/reset仍拒绝，失败保留输入不自动重试。`/stats.stages.queue` 在中心开始累计等待该计算信号量的秒数；旧版中心未采集共享锁等待，旧值0不能作为“原来不排队”的证据。原`compute`仍只统计融合计算（不含摘要），成功结果/字节计数/读取即移除语义不变。

## 请求体布局

| 顺序 | 内容 |
| --- | --- |
| 1 | 4 字节无符号小端整数，表示后续 JSON 目录的 UTF-8 字节数；不包含自身，最大 4096 字节。 |
| 2 | 非空 JSON 数组；每项精确为 `[通道名, dtype, shape]`，按后续数据的排列顺序列出。 |
| 3 | 依目录顺序排列的原数组字节；每个数组起点相对请求体开头按 8 字节对齐。 |

目录示例（省略其他通道）：

```json
[["cycle_ids","<i8",[64]],["PS1","<f4",[64,6000]]]
```

约束和偏移计算：

- 通道名为非空且不重复的字符串。`dtype` 仅接受 `<f4`（小端 float32）和 `<i8`（小端 int64）；本实验分别用于原信号和周期编号。
- `shape` 为一维或二维的正整数列表，不接受空维度、零长度、布尔数或非整数。
- 从 `offset = 4 + JSON字节数` 开始，每个数组先令 `offset += (-offset) % 8`，再读取 `product(shape) × dtype.itemsize` 字节，并递增 offset。没有单独的偏移字段。
- 数组按 C-order 连续存放，不压缩、不做数值转换。编码器以零字节填充对齐间隙；解码器跳过间隙。最后一个数组之后不能再有额外字节。
- 截断目录/数组、非法目录、重复通道或多余尾部数据均失败。原 `app.edge` 继续检查实际边缘组的完整通道集合、周期一致性及信号形状；算法原有非有限值检查保留。

解码器通过 `np.frombuffer(...).reshape(...)` 在不可变 `bytes` 上构造只读视图，不复制整块输入数组。视图持有原请求体的生命周期；边缘计算后先将小特征结果打包为 NPZ，再释放 `result`（含透传的 `cycle_ids` 视图）、输入数组和大请求体，随后同步转发云端。这里的零复制仅指拆包成数组，不表示 HTTP 收包、内核网络或特征编码无复制。

成功请求沿用 HTTP 200：该边缘的特征已被云端 `/partial` 接受。完整批次成功仍需三路处理后取得并核验云端结果；新格式不改变该条件，失败请求不自动重试。

## 测试数据与计量

```text
python fixtures.py prepare SOURCE OUTPUT [npz|arrays]
```

默认 `npz` 与原调用兼容。`arrays` 输出 `.arrays` 文件，manifest 最外层仍是原批次数组，只有对应 `files[]` 项增加 `contentType`；`name` 和完整文件 `length` 继续供发送端读取。文件中的原信号字节不变，`expected` 和 `inputBytes` 不改。

吞吐计量仍只累计各边缘组原信号数组的 `nbytes`：不计周期编号、目录、对齐填充、NPZ 封装、特征或结果字节，也不重复累计转发字节。`files[].length` 是上传文件长度，不得代替原信号计量。目标、实际发起及完整成功吞吐仍按既有各自边界记录，不因更换封装而提高计数字节数。

## 实际消费者与验证

以下路径均相对 `examples/hydraulic-cloud-edge/`：

| 文件 | 当前用途 |
| --- | --- |
| `resident/input_codec.py` | 导出 `CONTENT_TYPE`、`encode_input`、`decode_input`，实现上述格式。 |
| `resident/service.py` | `/process` 按类型解码，按原链路计算并转发；转发前释放大输入。 |
| `resident/fixtures.py` | 可选生成 arrays 文件；在线 verify 按 manifest 类型发送并逐数组核验 NPZ 结果。 |
| `resident/rate/load.js` | 使用 `file.contentType || 'application/octet-stream'` 发送完整文件，保留云端结果核验。 |
| `resident/rate/run.mjs` | HC-17 views 阶段选择 arrays 准备参数并校验 manifest 类型；旧基线仍用原镜像/NPZ。 |
| `resident/Dockerfile` | 将 codec、服务、fixtures 及测试装入新实验镜像；不覆盖旧实验镜像。 |

`resident/test_input_codec.py` 的 13 项测试覆盖逐字节/shape/dtype 保真、只读共享内存和对齐、输入生命周期、非法输入、小头上限、原算法输出一致、64+1 周期 fixtures、Content-Type，以及真实三边缘到云端 HTTP 链路的双格式结果一致性。

新镜像 `cea/hydraulic-resident:hc17-views` 内执行 `python -m unittest -v test_app test_service test_input_codec`，31 项全部通过。该结果只确认功能回归，不代替实际吞吐对照。

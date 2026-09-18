# FLPAR-24 纯计算区间试验

只做诊断，正式MET-001口径、页面和SDK不变。原FLPAR-22三客户端、累计10万条（唯一5万）、一轮一epoch、batch1024、线性模型、1线程、完整1万条评估不变；固定一次预热和三次正式，失败保留不补跑。

通过固定NamespaceFile挂载`profile_compute.py`，复用原par18预处理和par21线性镜像，无镜像重建/应用版本修改。所有输入用普通完整加载，关闭实验mmap；计算区间从输入完整读入后开始，到输出结果在内存准备完成、序列化写出前结束。保留模型建立/参数装载、校验、内存分配、归一化、训练和结果整理。初始化无文件输入，计模型初始化；聚合先完整读完各客户端模型再计聚合。

额外`compute-profile.json`记录read/compute/write墙钟时点和单调钟耗时，原SDK继续覆盖完整操作。报告在SDK关闭后产生，不登记为业务输出字节。新速率用原SDK真实业务输入输出文件大小除计算区间并集；不是内存带宽、磁盘吞吐或端到端吞吐，也不直接用于M01达标。加载方式变化可能影响内存和缓存，旧历史批次不作为配对对照；两口径来自同次执行。

数值核心直接复用原镜像函数。运行前做各阶段与原入口的逐张量对照；现场结束后再独立复算全部模型/评估，核对9个算法Job、报告和原对象/服务保留。无Java、DB、API、SPI或Kestra通用执行语义变化。

入口：`node run.mjs register`、`node run.mjs run`、`node run.mjs audit`、`models.ps1`、`node run.mjs verify`。工作目录为本文件目录；证据在忽略目录`.local/cea/par24`，不保存凭据或覆盖既有结果。

IDEA本地模式需设置`FLPAR24_API_ORIGIN=http://127.0.0.1:18185`、`FLPAR24_UI_ORIGIN=http://127.0.0.1:18100`；默认仍指向原Docker入口。选择已在运行的后端，不因测试启动、停止或切换系统。模块小数据测试：分别在`cea/federated-linear:par21-v1`运行`test_profile.ProfileTest`、在`cea/federated-preprocess:par18-v1`运行`test_profile.PreprocessTest`，挂载本目录至`/candidate`并设`PYTHONPATH=/app:/candidate`；流程定义测试为`node --test run.test.mjs`。

# 三个实际边缘处理策略

样例都从`edge-a`接入；`hydraulic-local`留边缘，`bearing-return`向原终端返回诊断，`surface-cloud`将摘要交给cloud生成报告。不是三个专用调度器。四个Application契约共用一个CPU算法镜像的四个命令，无上传SDK；文件由Pod助手提供。

## 数据与算法

- [UCI液压台架447](https://archive.ics.uci.edu/dataset/447/condition+monitoring+of+hydraulic+systems)：CC BY4.0；回放原前10个60秒周期的PS1/FS1/TS1，100/10/1Hz各自10秒窗口。有限值检查、缺失插值、均值/极值/标准差；原数据没有缺失，不人为增加脏数据制造效果。
- [CWRU轴承](https://engineering.case.edu/bearingdatacenter/download-data-file)：公开实验数据，未确认再分发许可，原数据不进入Git。选用12kHz fan-end信号，正常/内圈/滚珠/外圈四类；0–2HP源文件训练，3HP源文件独立测试，先按源实验分离再2048点非重叠切窗。随机森林使用RMS、峭度、峰值因子和8频带能量。不是剩余寿命预测或自动停机。
- [MVTec AD tile](https://www.mvtec.com/research-teaching/datasets/mvtec-ad)：CC BY-NC-SA4.0，仅非商业研究。正常训练图80%拟合、20%校准95%阈值，完整官方test做独立评估。终端回放每一类test的首张图，推理文件名不带类别。测试标签不进入训练/阈值选择。
- PaDiM依据[论文](https://arxiv.org/abs/2011.08785)和[Anomalib结构](https://github.com/open-edge-platform/anomalib/blob/main/src/anomalib/models/image/padim/torch_model.py)：ResNet18预训练多层特征、随机子空间、逐位置Gaussian/Mahalanobis。当前最小CPU实现128像素/32维，不是完整Anomalib依赖或论文精度复现。模型在准备阶段下载/拟合，任务执行不联网下载模型。

## 准备和部署

在backend根目录执行，数据和模型只写`.local/cea/edge-processing`：

```powershell
New-Item -ItemType Directory -Force .local/cea/edge-processing/raw
curl.exe -L --fail -o .local/cea/edge-processing/raw/hydraulic.zip https://archive.ics.uci.edu/static/public/447/condition+monitoring+of+hydraulic+systems.zip
curl.exe -L --fail -o .local/cea/edge-processing/raw/tile.tar.xz https://www.mydrive.ch/shares/150462/5479f0fdc97bc6fa16eab0cb0cf0109f/download/420938133-1629960456/tile.tar.xz
docker build -f examples/edge-processing/Dockerfile -t cea/edge-processing:ep01-v1 .
docker build -t cea/edge-gateway:ep01-v1 deploy/edge-gateway
docker run --rm --memory 2g --cpus 2 -e TORCH_HOME=/data/torch-cache -v "${PWD}/.local/cea/edge-processing:/data" cea/edge-processing:ep01-v1 python /app/prepare.py all
```

`prepare.py`记录具体源文件、训练/测试划分及真实评估，生成两个模型和三个终端批次文件。下载失败必须修复，不能用随机生成数据替代。已发布版本不可原地换模型；修改数据/模型时升版本并更新显式Flow地址。

测试通过后执行`deploy/cea/setup-edge-examples.ps1 -Publish`，新增CONNECT账号、专用网关S3权限、网关及3策略/4应用版本。只重建backend以读取配置，frontend仅reload，不重启数据库、Registry或集群。没有Java代码/API/DB migration。本脚本保留首次业务基线，遇到已有不同策略不覆盖；恢复时停网关并恢复backend配置，不删除历史或对象。

## 真实终端回放

```powershell
. ./deploy/cea/common.ps1
Invoke-CeaCompose run --rm --no-deps terminal-replay hydraulic-window /data/hydraulic.npz
Invoke-CeaCompose run --rm --no-deps terminal-replay bearing-window /data/bearing.npz
Invoke-CeaCompose run --rm --no-deps terminal-replay surface-batch /data/surface.zip
```

容器内文件只读挂载，只有终端token，无平台/S3密钥。每次都真正HTTP上传，随后发事件并轮询结果，收据保存到`.local/cea/edge-processing/evidence`。不是把已在边缘的地址假装成上传。网关本机入口18086，现有18080“边缘处理策略”和执行页可查看三个策略及其输出/Metrics。

`verify_live.py`验证真实上传字节、实际存储去向、重复事件、跨终端拒绝，下载产物用于`audit.py`独立数值比对。它是管理员验收工具，不装入终端、不改变执行链。详细协议及限制见[网关协议](../../docs/contracts/ep01-gateway.md)。

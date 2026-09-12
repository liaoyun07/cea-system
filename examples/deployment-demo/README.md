# CEA 常驻部署示例

一个无外部依赖的Python HTTP服务，用于验证镜像上传、按需分发、Deployment就绪计时、配置修改和手动扩缩容；不是一次性训练Job，不模拟性能达标。不需要数据集、MinIO凭据或计量SDK。

## 镜像与构建

在本目录运行`./build.ps1`。只构建本地`cea/deployment-demo:v1`、运行8项真实HTTP测试并导出仓库`.local/images/cea-deployment-demo-v1.tar`。固定linux/amd64及已验证的Python基础镜像digest；不上传Registry、不登记应用、不创建CEA部署。已有tar会拒绝覆盖。构建文件和tar不提交Git，源码及测试保留。

镜像默认`python /app/app.py`，UID/GID10001，监听8080，支持只读根文件系统。没有数据库、数据文件或启动下载。

## 页面操作

1. **应用与镜像 → 上传镜像**：应用ID填`cea-deployment-demo`、版本`v1`，选择导出的tar。可以不添加参数（使用镜像默认值）；如需演示配置编辑，添加`MESSAGE`，类型STRING，默认`Hello CEA`，非必填。[upload-contract.json](upload-contract.json)是等价上传API的contract部分，不是镜像引用。
2. 上传后**应用部署 → 新建部署**：集群选`edge-a`，名称填`cea-demo`，选择上一步应用/v1、副本1；命令按顺序填`python`、`/app/app.py`，参数JSON为`{"MESSAGE":"Hello CEA"}`（仅当已声明MESSAGE契约）；就绪检查路径`/healthz`、端口`8080`。[deployment.json](deployment.json)对应声明MESSAGE后的创建请求；无契约参数时改为`{}`。
3. 部署完成后刷新状态，查看本次有效就绪耗时。扩缩容可将副本改为2；修改MESSAGE用于演示配置滚动更新。应用详情底部的**按需分发历史**会记录部署调用的镜像准备，单纯扩缩容不会产生分发记录。
4. **运行资源 → edge-a → 容器用量**查询采样；新Pod可能需等待至少一轮采集。当前部署表单未提供容器resource limits，因此示例通常只有实际CPU核数/内存MiB，限额占比为`—`，不是采集失败。

## HTTP接口

- `GET /healthz`：200及`{"status":"ok"}`，用于就绪探针。
- `GET /`：服务名、实例hostname和MESSAGE，可检查配置及副本身份。
- `POST /statistics`：Content-Type为application/json，输入`{"values":[1,2,3,4]}`，返回count=4/min=1/max=4/mean=2.5；统计实际请求值，不是假数据。

请求最大256KiB、1..10000个有限数字。不提供鉴权/TLS，Python标准库[HTTP server](https://docs.python.org/3.11/library/http.server.html)仅用于隔离环境示例，不能直接作为公网生产服务。当前CEA常驻部署不会自动创建Service/Ingress或宿主端口，因此“就绪”不等于浏览器可以直接访问8080；可使用kubectl exec在Pod内请求，或单独准备受限端口转发，勿将容器端口当18080平台入口。

本次没有给平台新增Java、表或API，没有改变Execution主链。容器内健康/统计接口只是示例应用自身功能，不是另一套编排逻辑。验证见[记录](../../docs/verification/VER-UI-008-demo-image.md)。

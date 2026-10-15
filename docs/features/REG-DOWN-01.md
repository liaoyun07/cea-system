# REG-DOWN-01 镜像下载

镜像仓库库存行和详情都有“下载镜像”。用户选择的仓库、路径、摘要固定到一次请求，后端使用已配置凭据读取仓库，不执行镜像。普通镜像下载Docker-save `.tar`；多平台索引下载`.oci.tar`。

调用链：RegistryPage → 原认证API的二进制响应 → RegistryController → ImageDownloadService → RegistryManagementService READ/路径/摘要校验 → 原Skopeo copy → 归档 → HTTP传输 → finally清理。支持无标签；索引使用`--all --preserve-digests`保留全部平台。普通镜像Docker格式转换不承诺manifest摘要不变，保留实际镜像配置和层内容。

新增ImageDownloadService和一个GET接口，无业务表/迁移/工作流状态/新基础设施；与Kestra工作流语义无关。有限并发沿用镜像上传配置；传输结束、客户端断开或导出失败释放归档和名额。进程强制退出不保证finally执行，不增加定时清理服务。

普通镜像可用 `docker load -i 文件.tar`，也兼容现有应用上传。多平台OCI归档可用 `k3s ctr images import 文件.oci.tar` 或支持OCI镜像存储的Docker导入；旧Docker经典镜像存储不支持直接加载OCI。本次不扩大原应用上传的格式范围。

[协议](../contracts/ui09-registry-kubernetes.md)、[验证](../verification/VER-REG-DOWN-01.md)。

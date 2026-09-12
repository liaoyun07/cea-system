# UI-08-demo 示例镜像

日期：2026-09-13。源码基线：12c39aa。本批准备常驻HTTP部署示例，不更新CEA前后端、不登记或部署业务对象、不新增平台Java/表/API/SPI，也不改变Kestra参考的执行链。

验证PASS（2026-09-13 03:02–03:03 Asia/Shanghai）：

- `examples/deployment-demo/build.ps1`构建linux/amd64镜像，镜像内8项HTTP测试通过：健康、参数/实例、统计、非法值、非法JSON、请求超限、Content-Type和不存在路径。无pip下载；以Python标准库提供隔离环境演示，不作为公网生产HTTP服务。
- 另启动临时容器，采用默认CMD、不挂载源码、只读根文件系统、cap-drop ALL/no-new-privileges、128MiB内存与0.5 CPU上限，宿主仅127.0.0.1随机端口。实际UID/GID10001；`/healthz`返回ok，MESSAGE覆盖回显正确，`[1,2,3,4]`实际返回count4/min1/max4/mean2.5。正常SIGTERM退出码0、无OOM，临时容器已删除。
- Docker save导出`.local/images/cea-deployment-demo-v1.tar`，45467136字节（43.36MiB）。manifest只有一个镜像和`cea/deployment-demo:v1`标签；使用与平台相同的Skopeo v1.20.0成功inspect docker-archive，amd64/linux，摘要`sha256:a5a9d7880e32a6af70aa92610084eefb0f52f24f369a5407483fcbb33429aa65`。实际本地镜像ID为`sha256:c7db64424c85ad25cc42c6e61bd698e4e1b2ac1562d8ef9db07600711e229787`。
- 增加一个可选STRING参数MESSAGE，真实消费者为示例GET /回显，用于配置修改演示；8080固定，不增加没用的配置项、文件上报或SDK。
- 未向CEA上传/登记/分发或创建Deployment，没有新建Service/Ingress、重启CEA或更改Flow/历史。Docker健康验证不是K3s部署耗时实测，也不是30秒性能达标。Java和前端业务代码未改，不重复宣称历史Maven/浏览器回归为本次结果；结构检查PASS：8模块、93份Java、32个功能编号、498个本地链接，git diff检查通过。

本地构建/测试日志`.local/deployment-demo-build.log`；归档和日志均不提交Git。这里只增加示例Python/Docker/契约/请求/测试和文档，不新增平台类、表、HTTP API或执行链。

示例及操作：[README](../../examples/deployment-demo/README.md)。本地tar在Git忽略目录，不提交构建产物或凭据。

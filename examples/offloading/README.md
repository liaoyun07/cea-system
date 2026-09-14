# OFF-02/03 三条卸载路径与真实观测

OFF-04新增所属网关Double DQN，使用本例同一算法/文件/Runner；新增独立研究策略而非覆盖下列原4个策略。六维计算仍用OFF-03，不让业务镜像嵌入训练器。主动采样与五策略比较见[研究脚本说明](../../algorithms/offloading/README.md)，结果见[验证记录](../../docs/verification/VER-OFF-04-double-dqn.md)。

OFF-03已发布：三层执行继续使用同一OFF-02算法镜像、文件协议和Flow。终端客户端新增单进程端到端计时/反馈，网关与Pod公共助手报告实际传输，后端记录六维与下一决策关联。18080“卸载观测”可以查看；[计算方法与缺测边界](../../docs/contracts/off03-measurement.md)、[实际验证](../../docs/verification/VER-OFF-03-measured-feedback.md)。初次缺少传输历史的样本只用于标定，后续记录不会倒填它的状态；连续请求的最后一条没有next，不显示可训练。

`deploy/cea/verify-offloading-measurement.mjs`是主动验收脚本：会新建六次请求，并在原终端样本目录生成约63.25MiB的44段重复合成信号用于并发验证；它不是只读巡检，不应反复运行来“检查部署”。现有本批执行及回执已保留。实际测量和反馈只在原客户端进程内有效；重用未完成receipt而原进程计时已丢失时标记UNMEASURED，不伪造全程耗时。算法本身无需增加SDK。

本例做振动窗口特征提取与阈值告警：131072个采样点，输出均值/RMS/峰值/窗口数/告警窗口数。数据由prepare.py确定性模拟，包含16个冲击；**不是实测工业数据、训练模型或DQN性能基准**。同一文件、同一镜像在三层执行，独立参考值位于本地signal-manifest.json。

已授权的CEA安装脚本为[setup-offloading-paths.ps1](../../deploy/cea/setup-offloading-paths.ps1)，只新增offload-signal/off02-v1和4个策略，不修改原三策略、FedAvg/FedProx或历史。安装/验证状态见[进度](../../docs/04-progress.md)，不要在未测试的代码上直接Publish。

原始文件存终端代理的只读`/data/<fileId>`。客户端仅发元数据；是Worker决策后的网关物化操作真正上传，客户端不会预上传。

部署完成后，在backend的PowerShell中：

```powershell
. ./deploy/cea/common.ps1
$taskSignal=Get-Content .local/cea/off02/signal-manifest.json -Raw | ConvertFrom-Json
Invoke-CeaCompose run --rm --no-deps terminal-compute --event offload-terminal --file "/data/$($taskSignal.fileId)" --receipt /evidence/terminal.json
Invoke-CeaCompose run --rm --no-deps terminal-compute --event offload-edge --file "/data/$($taskSignal.fileId)" --receipt /evidence/edge.json
Invoke-CeaCompose run --rm --no-deps terminal-compute --event offload-cloud --file "/data/$($taskSignal.fileId)" --receipt /evidence/cloud.json
Invoke-CeaCompose run --rm --no-deps terminal-compute --event offload-rule --file "/data/$($taskSignal.fileId)" --receipt /evidence/rule.json
```

同一receipt再次运行只查询同一请求/执行，不再次创建任务。有意另执行一次须用另一个receipt路径。不要覆盖fileId内容或删除未决请求收据。

在18080“边缘与终端 → 边缘处理记录”查看新增4条记录及原执行详情；策略页可查看源码，卸载观测可看FIXED/RULE及实际target。CLOUD产物在中心，EDGE/TERMINAL结果在edge-a；本地原始数据在终端不上传。额外的缓存、任务历史和容器不自动清理，本批不做GC或离线续跑。

最小策略示意（实际脚本按层生成4份原Flow定义，无新DSL模板表）：

```yaml
schemaVersion: 1
namespace: lab
id: offload-edge
inputs:
  data_file: {type: OBJECT, required: true}
tasks:
  - id: features
    type: platform.Application
    timeout: PT2M
    container:
      applicationId: offload-signal
      version: off02-v1
      execution: TERMINAL
      offload: {strategy: FIXED, layer: EDGE}
      command: [python, /app/app.py]
      inputFiles:
        signal.csv: {source: INPUT, name: data_file}
      outputFiles: [result.json]
outputs:
  terminal_result: {source: TASK_OUTPUT, taskId: features, port: result.json}
```

RULE换为`offload: {strategy: RULE}`；省略offload仍是固定来源终端执行。TERMINAL来源必须是网关已接受的请求，不能在普通人员创建Execution时伪造终端身份。

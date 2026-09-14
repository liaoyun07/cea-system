# 小、中、大边缘服务部署测试

MET-04复用现有算法，新增三个**常驻HTTP示例服务**，不改变平台Java、执行链、Deployment管理或计时协议。仅用于CEA隔离实验；没有公网鉴权/TLS，不应直接暴露到互联网。体积来自实际依赖和模型，不填充无用文件。

| 档位 | 服务与请求 | 依赖及结果 |
|---|---|---|
| small | `POST /analyze`，JSON `{"samples":[0,1,-1]}` | Python标准库，复用OFF-02振动统计；输出样本数、均值、RMS、峰值、超限窗口数；不是训练分类器 |
| medium | `POST /predict`，application/octet-stream的NPZ | NumPy/SciPy/scikit-learn、既有CWRU随机森林；12kHz、2048点窗口，输出类别/置信度/数量 |
| large | `POST /inspect`，image/png | NumPy/SciPy/PyTorch CPU/Torchvision/Pillow，既有ResNet18-PaDiM；输出异常分数、缺陷判断及32×32热力图 |

模型在构建时从本地受信目录放入镜像，运行时不下载/训练，也不接受请求提供pickle或模型。三镜像非root，推理线程1；服务只有模型加载和实际预热完成后才监听8080，`GET /healthz`才可返回200。无效模型启动失败，不返回伪就绪。平台HTTP readiness仍沿现有一秒观察/探针协议，不另造计时SDK。

## 数据与结果校验

复用[EP-01](../edge-processing/README.md)已有私有数据：小服务用CWRU独立测试的第一个振动片段；中服务用原CWRU独立测试窗口；大服务用原MVTec tile回放的第一张PNG，不按推理分数选样本。中、大模型未重训，阈值未调整。小服务使用独立标量计算核对，中/大使用原批处理算法输出作包装等价性核对；不是新的精度评测或独立论文复现。

数据、训练模型、探针载荷、镜像归档和实测原始记录均留在`.local`，不提交公开仓库。CWRU未确认再分发许可；MVTec AD数据仅非商业研究，具体来源/划分与限制沿EP-01。模型随本地CEA镜像部署，不对外发布。

## 构建与测试

在backend根目录执行：

```powershell
./examples/deployment-benchmark/build.ps1
node examples/deployment-benchmark/run.mjs
# 将下一行参数替换为run脚本实际输出的本地证据目录
node examples/deployment-benchmark/verify-ui.mjs .local/cea/met04/met04-v1/cea-实际时间
```

构建读取`.local/cea/edge-processing/models`及terminal数据，须先具备EP-01已准备的真实材料；不重新下载。先用原算法生成校验请求，再执行每镜像8项HTTP/真实输出/异常/模型失败测试，导出三个独立tar。已有归档拒绝覆盖。

`run.mjs`先冻结plan并保存CEA原业务/容器快照；通过**原上传接口**注册三个`met04-* / met04-v1`应用，然后在同一`edge-a`依次进行每服务4次CREATE：第1次服务首次部署（基础层可能存在），其后3次热缓存重建。每次副本1、`/healthz:8080`，保存后台原始起止/耗时、Pod状态/事件、所需层与节点content列表的交集、真实业务响应。不能仅凭新部署名称称为全冷启动；content交集仅表示当时可见的内容摘要，不包含所有可复用解包快照，不是网络实际传输字节，交集为0也不能证明全冷缓存。热缓存另以Pod事件中“image already present”核实。

已有应用版本拒绝重复注册；重新试验须显式指定新版本，例如先`build.ps1 -Version met04-v2`，再`node examples/deployment-benchmark/run.mjs met04-v2`，不能覆盖历史镜像。新版本/新名称同样不等于清除缓存。

计时从原平台分发准备前到同UID/generation全部副本就绪，不包含之前构建上传；失败/无效计时保留。预先判定每个样本须有效≤30秒、部署成功且业务结果正确；不只取最快值，不把热缓存通过推断为无缓存或物理WAN通过。

每次记录完成后仅删除本次创建的Deployment，并验证UID/操作身份与Pod结束；不清理节点/Registry层、不删除平台历史。最后额外创建三个可在18080查看的常驻部署（与各自测试名称相同，可看完整操作历史），这三次展示部署单独记录，不混入4次试验统计。原CEA容器/流程/执行/策略/数据集/卸载样本必须与快照一致。

完整无基础层缓存测试需要隔离的新节点和仓库，目前已单独请求允许；不在此脚本中悄悄新建或清空。正式测试结果、缓存边界与未达项见[验证记录](../../docs/verification/VER-M04-edge-deployment.md)。

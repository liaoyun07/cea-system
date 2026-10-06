# 完整流任务耗时对照

FL-CONV-02逐组探索的首组：FedAvg10轮，FedCADS7轮；共同原MNIST/MLP/lr0.1/batch128/epoch1、CADS alpha0.001/rho0.1，内部schedule保持12。计真实流程startedAt→endedAt，不更改引擎或增加自动早停。只有两边最终测试准确率均≥90%才比较提升。

实验入口flow_entry.py调用原镜像的app.run，不采集内部算法字节/耗时报告，也不伪造报告；以固定修订Namespace文件随每个Job挂载，不改公共SDK。两个新Flow复用原conv01-v1契约/镜像，原业务异常仍导致失败。

```powershell
node --test examples/federated/flow-duration/run.test.mjs
docker run --rm --mount "type=bind,source=$PWD/examples/federated/flow-duration,target=/experiment,readonly" -e PYTHONPATH=/experiment cea/federated:fedcads-v2 python -m unittest test_flow_entry
# register仅首次创建，不覆盖已有Flow或脚本
node examples/federated/flow-duration/run.mjs register
node examples/federated/flow-duration/run.mjs run
# 首组完成后，独立第二组Avg11/CADS8、新种子81/91/101/111/121。
node examples/federated/flow-duration/run.mjs prepare --next
node examples/federated/flow-duration/run.mjs run --next
# 两组全部结束后独立回读模型/Job，不在计时运行中执行核验。
./examples/federated/flow-duration/audit.ps1 -Batch cea-1
./examples/federated/flow-duration/audit.ps1 -Batch cea-2
```

2次预热不计，五种子交替，失败/未达标不替换、不只挑最快时间；结果见[验证记录](../../../docs/verification/VER-FL-CONV-02.md)。

两组已完成：10/7首组两对未达准确率；11/8新五对完整Flow效率平均33.57%、每对≥25%，均最终≥90%。但最早达到90%诊断平均仅24.17%，不能混同最短收敛提升。当前两实验Flow为r1、默认仍是首组10/7；在页面运行复现第二组需分别输入rounds=11/8，CADS内部schedule自动保持12。原公共SDK未改，实验内部速率显示不可用是预期。19Python/3Node、964真实Job/初权重/计时/34旧评估核验通过。

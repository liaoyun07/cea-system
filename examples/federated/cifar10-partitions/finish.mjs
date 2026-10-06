import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export async function finish(root){
  const folder=path.join(root,'.local/cea/cifar10-partitions');
  const audits=[];
  for(const kind of ['equal','strong']){
    for(const algorithm of ['fedavg','fedcads']){
      const trial=JSON.parse(await fs.readFile(path.join(folder,`flow-${kind}/${algorithm}.json`),'utf8'));
      if(trial.execution.state!=='SUCCESS')throw new Error('Do not summarize an incomplete experiment');
    }
    execFileSync('pwsh',['-NoProfile','-File',path.join(root,'examples/federated/cifar10-partitions/audit.ps1'),'-Kind',kind],
      {cwd:root,stdio:'inherit',timeout:600000});
    audits.push({kind,...JSON.parse(await fs.readFile(path.join(folder,`flow-${kind}/audit.json`),'utf8'))});
  }
  await fs.writeFile(path.join(folder,'comparison.json'),JSON.stringify(audits,null,2),{flag:'wx'});
  const rows=audits.flatMap(a=>a.results.map(r=>`| ${a.kind} | ${r.algorithm} | ${(r.bestAccuracy*100).toFixed(2)}% | ${(r.finalAccuracy*100).toFixed(2)}% | ${r.first90Round??'未达标'} | ${r.first90Seconds?.toFixed(3)??'—'} | ${r.wholeFlowSeconds.toFixed(3)} |`));
  const gains=audits.map(a=>`${a.kind}：${a.speedGainPercent===null?'至少一方未达到90%，无法计算90%达标速率提升':`速率提升 ${a.speedGainPercent.toFixed(2)}%`}`);
  await fs.writeFile(path.join(folder,'comparison.md'),[
    '# CIFAR-10 两种非IID划分：40轮实际结果',
    '', '| 划分 | 方法 | 最高准确率 | 第40轮准确率 | 首次90%轮次 | 首次90%耗时(s) | 完整40轮(s) |',
    '|---|---|---:|---:|---:|---:|---:|',...rows,'',...gains,'',
    '计时为Flow启动到首次达标轮评估结束，无早停。单种子31、依次运行、无独立预热，不能宣称稳定提升。',
    '原CNN、epoch1/batch128/lr0.1、CADS alpha0.001/rho0.1/schedule40。完整50000训练/10000官方测试。',
    '两组实际模型及804个Job独立核验通过。未达标不外推、不伪造达标耗时。',''].join('\n'),{flag:'wx'});
  console.log(`Verified comparison: ${path.join(folder,'comparison.md')}`);
}

import {chromium} from '../../../../frontend/node_modules/playwright-core/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {api} from './run.mjs';
const folder='.local/cea/flow-dep-01-20261018';
const env=Object.fromEntries(readFileSync('deploy/cea/.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+(env.CEA_HTTP_PORT||18080));await page.getByLabel('账号',{exact:true}).fill(env.BACKEND_USER);await page.getByLabel('密码',{exact:true}).fill(env.BACKEND_PASSWORD);await page.getByRole('button',{name:'连接工作空间 →',exact:true}).click();
  await page.getByRole('button',{name:'＋ 新建流程',exact:true}).click();const id='verify-deployment-editor';await page.getByLabel('流程 ID',{exact:true}).fill(id);await page.getByRole('button',{name:'创建空流程',exact:true}).click();
  await page.getByRole('button',{name:'添加到 任务',exact:true}).click();await page.getByLabel('任务类型',{exact:true}).selectOption('platform.Deployment');await page.getByLabel('任务 ID',{exact:true}).fill('deploy_cloud');await page.getByRole('button',{name:'添加到流程',exact:true}).click();
  await page.getByLabel('应用与版本',{exact:false}).selectOption(JSON.stringify(['hydraulic-resident','flow-v1']));
  await page.locator('.cluster-picker button').filter({hasText:'cloud ·'}).click();
  const role=page.locator('[data-field="tasks.0.container.parameters.ROLE"]');await role.locator('button.field-enable').click();
  // The contract's choices use the same BindingField control as Application.
  await role.locator('select').last().selectOption({label:'cloud'});
  await page.getByLabel('副本数',{exact:true}).fill('0');await page.getByLabel('副本数',{exact:true}).blur();
  await page.getByRole('button',{name:'✓ 校验',exact:true}).click();await page.getByRole('status').filter({hasText:'校验通过'}).waitFor();
  await page.getByRole('button',{name:'保存修订',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存修订 r1'}).waitFor();
  await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('status').filter({hasText:'已读取最新修订 r1'}).waitFor();
  assert.equal(await page.getByLabel('副本数',{exact:true}).inputValue(),'0');
  const saved=await api('/flows/'+id);assert.equal(saved.definition.tasks[0].type,'platform.Deployment');assert.equal(saved.definition.tasks[0].container.parameters.ROLE.value,'cloud');assert.deepEqual(saved.definition.tasks[0].container.candidateClusters.value,['cloud']);
  assert.equal(await page.getByText('输入文件绑定',{exact:true}).count(),0);assert.equal(await page.getByText('声明输出文件名',{exact:true}).count(),0);
  await page.screenshot({path:folder+'/editor.png',fullPage:true});
  await page.getByRole('navigation').getByRole('button',{name:'数据流编排',exact:true}).click();
  await page.getByLabel('搜索流程',{exact:true}).fill('hydraulic-resident-services');await page.getByRole('button',{name:'搜索',exact:true}).click();
  await page.getByRole('button',{name:'hydraulic-resident-services',exact:true}).click();
  await page.locator('[data-task="deploy_edge_a"] > .task-card-header .task-select').click();
  const binding=page.locator('[data-field="tasks.1.tasks.0.container.parameters.CLOUD_URL"]');
  assert.equal(await binding.getByLabel('参数来源',{exact:true}).inputValue(),'TASK_OUTPUT');
  assert.equal(await binding.getByLabel('上游任务',{exact:true}).inputValue(),'deploy_cloud');
  assert.equal(await binding.getByLabel('输出端口',{exact:true}).inputValue(),'endpoint');
  await page.screenshot({path:folder+'/services-flow.png',fullPage:true});
  assert.deepEqual(errors,[]);writeFileSync(folder+'/page.json',JSON.stringify({status:'PASS',draftFlow:id,executionStarted:false,servicesFlow:'hydraulic-resident-services',upstreamBinding:true},null,2));console.log('PAGE_PASS; visual editing, shared parameters, save/reload and upstream endpoint');
} finally {await browser.close();}

// Read-only release smoke against CEA; never submits, edits or deletes business objects.
import { chromium } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.CEA_E2E_URL || 'http://127.0.0.1:18080';
const user = process.env.CEA_E2E_USER,
  password = process.env.CEA_E2E_PASSWORD;
if (!user || !password) throw new Error('Provide CEA_E2E_USER/PASSWORD in process environment.');
const evidence = resolve(import.meta.dirname, '../../.local/cea/ep02');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const checks = [];
try {
  await page.goto(url);
  await page.getByLabel('账号', { exact: true }).fill(user);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '连接工作空间 →' }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '边缘处理记录', exact: true })
    .click();
  await page.locator('.edge-record-table tbody tr').first().waitFor();
  await page.screenshot({ path: resolve(evidence, 'desktop.png'), fullPage: true });
  for (const policy of ['hydraulic-local', 'bearing-return', 'surface-cloud']) {
    const response = page.waitForResponse(
      (r) => r.url().includes('/edge/processing-records?') && r.url().includes(`policyId=${policy}`),
    );
    await page.getByRole('combobox', { name: '策略', exact: true }).selectOption(policy);
    const rows = await (await response).json();
    assert(rows.length > 0);
    await page.locator('.edge-record-table tbody tr').first().waitFor();
    assert.equal(await page.locator('.edge-record-table tbody tr').count(), rows.length);
    const selected = rows[0];
    assert.equal(selected.execution.state, 'SUCCESS');
    assert.equal(selected.origin.terminalId, 'ep01-terminal');
    assert.equal(selected.origin.gatewayId, 'ep01-gateway');
    assert.equal(selected.origin.clusterId, 'edge-a');
    await page
      .locator('.edge-record-table tbody tr')
      .first()
      .getByRole('button', { name: '详情与结果 →' })
      .click();
    await page.locator('h1 .status').waitFor();
    await page.getByRole('tab', { name: '输出', exact: true }).click();
    const outputText = await page.locator('.execution-page').innerText();
    for (const name of Object.keys(selected.execution.outputs))
      assert(outputText.includes(name), `Missing output ${name}`);
    const previewPort = {
      'hydraulic-local': 'summary.json',
      'bearing-return': 'diagnosis.json',
      'surface-cloud': 'report.json',
    }[policy];
    await page
      .locator('.artifact-table tbody tr')
      .filter({ has: page.getByRole('cell', { name: previewPort, exact: true }) })
      .getByRole('button', { name: '预览 JSON', exact: true })
      .click();
    await page.getByTestId('artifact-json').waitFor();
    const preview = JSON.parse(await page.getByTestId('artifact-json').textContent());
    assert(Object.keys(preview).length > 0);
    checks.push({
      policy,
      executionId: selected.execution.id,
      outputs: Object.keys(selected.execution.outputs),
      previewPort,
      previewKeys: Object.keys(preview),
    });
    await page.getByRole('button', { name: '← 返回处理记录' }).click();
    await page.locator('.edge-record-table tbody tr').first().waitFor();
    assert.equal(await page.getByRole('combobox', { name: '策略', exact: true }).inputValue(), policy);
  }
  await page.getByRole('combobox', { name: '策略', exact: true }).selectOption('');
  await page.locator('.edge-record-table tbody tr').nth(2).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(evidence, 'narrow.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(evidence, 'browser.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), url, checks, errors, result: 'PASS' }, null, 2),
  );
  console.log(
    `PASS: CEA edge records, ${checks.length} policies, original outputs, desktop/390px, no business writes.`,
  );
} finally {
  await browser.close();
}

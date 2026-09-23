import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../web/operator/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../web/operator/app.mjs', import.meta.url), 'utf8');

test('operator onboarding exposes every referenced control with unique IDs', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of script.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), match[1]);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /填入教学示例/);
  assert.match(html, /付款在系统外完成/);
  assert.match(html, /本版本不保存单位字段/);
});

test('CSV cells escape quotes and neutralize spreadsheet formulas', () => {
  const source = script.slice(script.indexOf('function csvCell('), script.indexOf("$('csv').onclick"));
  const csvCell = runInNewContext(source + '\ncsvCell;');
  assert.equal(csvCell('buyer-1'), '"buyer-1"');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  for (const value of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '\t=1+1']) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell('中文订单'), '"中文订单"');
  assert.equal(csvCell(null), '""');
});

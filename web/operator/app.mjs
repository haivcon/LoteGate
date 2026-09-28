const $ = id => document.getElementById(id);
let key = '', selected = null, current = null, busy = false;
const labels = { READY: '已锁定 — 可以执行', QUEUED: '排队等待处理', RUNNING: '正在 X Layer 上计算', COMPLETED: '已验证 — 尚未付款', FAILED: '执行失败', INTERRUPTED: '执行中断 — 需要重试' };
function notice(message) { $('notice').textContent = message; }
async function api(path, body) {
  const response = await fetch('/api/' + path, { headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || '无法读取服务响应'); return result;
}
function element(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
function addOrder(values = {}) {
  if ($('orders').children.length >= 64) return notice('每个批次最多支持 64 笔订单。');
  const row = element('tr');
  for (const field of ['id', 'side', 'price', 'quantity']) {
    const cell = element('td'), input = element(field === 'side' ? 'select' : 'input'); input.dataset.field = field; input.setAttribute('aria-label', field);
    if (field === 'side') for (const [value, label] of [['buy', '买入'], ['sell', '卖出']]) { const option = element('option', label); option.value = value; input.append(option); }
    else { input.required = true; if (field === 'id') input.maxLength = 80; else { input.type = 'number'; input.min = '1'; input.max = '4294967295'; input.step = '1'; } }
    if (values[field] !== undefined) input.value = values[field]; cell.append(input); row.append(cell);
  }
  const cell = element('td'), remove = element('button', '×'); remove.type = 'button'; remove.className = 'secondary'; remove.setAttribute('aria-label', '删除订单'); remove.onclick = () => row.remove(); cell.append(remove); row.append(cell); $('orders').append(row);
}
async function detail() {
  if (!selected) return;
  const r = await api('batches/' + selected); current = r;
  $('detail-title').textContent = r.name; $('phase').textContent = labels[r.phase] || r.phase;
  $('progress').textContent = r.error || (r.progress ? (r.progress.stage === 'MATCHING' ? `已处理 ${r.progress.requests} 个撮合请求。` : `已计算 ${r.progress.allocations}/${r.progress.total} 笔订单的金额。`) : '');
  $('run').hidden = !['READY', 'FAILED', 'INTERRUPTED'].includes(r.phase);
  $('run').textContent = r.phase === 'READY' ? '开始计算分配' : '从锁定订单重新计算';
  $('download').hidden = r.phase !== 'COMPLETED'; $('csv').hidden = r.phase !== 'COMPLETED';
  const guidance = { READY: '订单已锁定。下一步：点击开始计算分配。', QUEUED: '任务已排队，无需重复提交。', RUNNING: '正在计算，可能需要几分钟或更久。每 5 秒自动刷新，关闭页面不会取消任务。', COMPLETED: '计算完成，尚未付款。请导出对账表并在系统外安排付款和交付。', FAILED: '执行失败。请检查下方错误和 RPC 连接，再手动重试。', INTERRUPTED: '执行已中断。重试将从锁定输入重新计算。' };
  $('next-step').textContent = guidance[r.phase] || r.phase;
  $('metrics').replaceChildren(); $('allocations').replaceChildren();
  if (r.result) {
    for (const [label, value] of [['成交价', r.result.clearingPrice], ['数量', r.result.volume], ['手续费', r.result.totalFees]]) { const card = element('div'); card.append(element('span', label), element('strong', value)); $('metrics').append(card); }
    const table = element('table'), header = element('tr'); for (const text of ['订单编号', '已成交', '剩余', '应付金额', '应收金额', '手续费']) header.append(element('th', text)); table.append(header);
    for (const a of r.result.allocations) { const row = element('tr'); for (const field of ['id', 'filled', 'unfilled', 'quotePaid', 'quoteReceived', 'fee']) row.append(element('td', a[field])); table.append(row); } $('allocations').append(table);
  }
  $('technical').textContent = JSON.stringify({ id: r.id, commitment: r.commitment, resultHash: r.resultHash, execution: r.execution, settlement: r.settlement }, null, 2);
}
async function refresh() {
  const list = await api('batches'); $('batches').replaceChildren();
  for (const r of list.reverse()) { const button = element('button'); button.className = 'batch secondary'; button.append(element('strong', r.name), element('span', `${r.orderCount} 笔订单 · ${labels[r.phase]}`)); button.onclick = () => perform(async () => { selected = r.id; await detail(); }); $('batches').append(button); }
  if (!list.length) $('batches').append(element('p', '暂无批次。请在下方创建第一个批次。'));
  await detail();
}
async function perform(action) { if (busy) return; busy = true; try { await action(); } catch (e) { notice(e.message); } finally { busy = false; } }
$('login').onsubmit = e => { e.preventDefault(); perform(async () => { key = $('token').value; await refresh(); $('token').value = ''; $('access').hidden = true; $('workspace').hidden = false; notice('已连接服务。'); }); };
$('logout').onclick = () => location.reload();
$('add').onclick = addOrder; $('refresh').onclick = () => perform(refresh);
$('create').onsubmit = e => { e.preventDefault(); perform(async () => {
  const orders = [...$('orders').children].map(row => Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.value])));
  if (!orders.length) throw Error('请至少输入一笔订单。');
  if (!confirm('确认锁定订单簿？保存后将无法修改此批次中的订单。')) return;
  const r = await api('batches', { name: $('name').value, mode: $('mode').value, feeBps: Number($('fee').value), orders }); selected = r.id; await refresh(); notice('订单已锁定。请在结果区域点击开始计算分配。'); $('detail-title').focus();
}); };
$('run').onclick = () => perform(async () => { if (!current || !confirm('确认开始执行？根据订单数量和 RPC 状况，计算可能需要几分钟或更长时间。此操作不会转移代币。')) return; await api('batches/' + current.id + '/run', { revision: current.revision }); await refresh(); });
$('download').onclick = () => { if (!current?.result) return; const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })); const a = element('a'); a.href = url; a.download = 'LoteGate-' + current.id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
setInterval(() => { if (key && !$('workspace').hidden && !document.hidden) perform(refresh); }, 5000);
addOrder(); addOrder();
function updateSummary() {
  const rows = [...$('orders').children];
  const buys = rows.filter(row => row.querySelector('[data-field="side"]').value === 'buy').length;
  $('order-summary').textContent = `${rows.length}/64 笔订单：${buys} 笔买单，${rows.length - buys} 笔卖单。`;
  $('fee-preview').textContent = `${Number($('fee').value) / 100}%`;
}
$('orders').addEventListener('input', updateSummary);
$('orders').addEventListener('click', () => updateSummary());
$('fee').addEventListener('input', updateSummary);
$('add').onclick = () => { addOrder(); updateSummary(); };
$('sample').onclick = () => {
  const hasInput = $('name').value || [...$('orders').querySelectorAll('input')].some(input => input.value);
  if (hasInput && !confirm('用教学示例替换当前未保存的输入？已保存批次不受影响。')) return;
  $('name').value = '教学示例 · 整数单位'; $('mode').value = 'double'; $('fee').value = '0'; $('orders').replaceChildren();
  addOrder({ id: 'buyer-1', side: 'buy', price: '20', quantity: '3' });
  addOrder({ id: 'seller-1', side: 'sell', price: '10', quantity: '3' });
  updateSummary(); notice('示例已填入，尚未保存。预期成交价 10、数量 3、应付和应收金额均为 30。请核对后锁定。');
};
function csvCell(value) {
  const text = String(value ?? '');
  return '"' + (/^\s*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
}
$('csv').onclick = () => {
  if (current?.phase !== 'COMPLETED' || !current.result) return;
  const fields = ['id', 'filled', 'unfilled', 'quotePaid', 'quoteReceived', 'fee'];
  const rows = [['批次', current.name], ['批次 ID', current.id], ['状态', '仅计算，尚未付款'], ['成交价', current.result.clearingPrice], ['订单编号', '成交数量', '剩余数量', '应付金额', '应收金额', '手续费'], ...current.result.allocations.map(a => fields.map(f => a[f]))];
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = element('a'); a.href = url; a.download = 'LoteGate-' + current.id + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
updateSummary();

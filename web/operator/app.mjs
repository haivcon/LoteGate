const $ = id => document.getElementById(id);
let key = '', selected = null, current = null, busy = false;
const labels = { READY: 'Đã chốt — sẵn sàng chạy', QUEUED: 'Đang chờ xử lý', RUNNING: 'Đang tính toán trên X Layer', COMPLETED: 'Đã kiểm chứng — chưa thanh toán', FAILED: 'Thực thi thất bại', INTERRUPTED: 'Bị gián đoạn — cần chạy lại' };
function notice(message) { $('notice').textContent = message; }
async function api(path, body) {
  const response = await fetch('/api/' + path, { headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Không đọc được dịch vụ'); return result;
}
function element(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
function addOrder() {
  if ($('orders').children.length >= 64) return notice('Tối đa 64 lệnh mỗi phiên.');
  const row = element('tr');
  for (const field of ['id', 'side', 'price', 'quantity']) {
    const cell = element('td'), input = element(field === 'side' ? 'select' : 'input'); input.dataset.field = field; input.setAttribute('aria-label', field);
    if (field === 'side') for (const [value, label] of [['buy', 'Mua'], ['sell', 'Bán']]) { const option = element('option', label); option.value = value; input.append(option); }
    else { input.required = true; if (field === 'id') input.maxLength = 80; else { input.type = 'number'; input.min = '1'; input.max = '4294967295'; input.step = '1'; } }
    cell.append(input); row.append(cell);
  }
  const cell = element('td'), remove = element('button', '×'); remove.type = 'button'; remove.className = 'secondary'; remove.setAttribute('aria-label', 'Xóa lệnh'); remove.onclick = () => row.remove(); cell.append(remove); row.append(cell); $('orders').append(row);
}
async function detail() {
  if (!selected) return;
  const r = await api('batches/' + selected); current = r;
  $('detail-title').textContent = r.name; $('phase').textContent = labels[r.phase] || r.phase;
  $('progress').textContent = r.error || (r.progress ? (r.progress.stage === 'MATCHING' ? `Đã xử lý ${r.progress.requests} yêu cầu ghép lệnh.` : `Đã tính giá trị ${r.progress.allocations}/${r.progress.total} lệnh.`) : '');
  $('run').hidden = !['READY', 'FAILED', 'INTERRUPTED'].includes(r.phase);
  $('run').textContent = r.phase === 'READY' ? 'Chạy trên X Layer' : 'Chạy lại từ sổ lệnh đã chốt';
  $('download').hidden = r.phase !== 'COMPLETED';
  $('metrics').replaceChildren(); $('allocations').replaceChildren();
  if (r.result) {
    for (const [label, value] of [['Giá khớp', r.result.clearingPrice], ['Khối lượng', r.result.volume], ['Phí', r.result.totalFees]]) { const card = element('div'); card.append(element('span', label), element('strong', value)); $('metrics').append(card); }
    const table = element('table'), header = element('tr'); for (const text of ['Mã lệnh', 'Khớp', 'Còn lại', 'Phải trả', 'Được nhận', 'Phí']) header.append(element('th', text)); table.append(header);
    for (const a of r.result.allocations) { const row = element('tr'); for (const field of ['id', 'filled', 'unfilled', 'quotePaid', 'quoteReceived', 'fee']) row.append(element('td', a[field])); table.append(row); } $('allocations').append(table);
  }
  $('technical').textContent = JSON.stringify({ id: r.id, commitment: r.commitment, resultHash: r.resultHash, execution: r.execution, settlement: r.settlement }, null, 2);
}
async function refresh() {
  const list = await api('batches'); $('batches').replaceChildren();
  for (const r of list.reverse()) { const button = element('button'); button.className = 'batch secondary'; button.append(element('strong', r.name), element('span', `${r.orderCount} lệnh · ${labels[r.phase]}`)); button.onclick = () => perform(async () => { selected = r.id; await detail(); }); $('batches').append(button); }
  if (!list.length) $('batches').append(element('p', 'Chưa có phiên. Tạo phiên đầu tiên ở bên dưới.'));
  await detail();
}
async function perform(action) { if (busy) return; busy = true; try { await action(); } catch (e) { notice(e.message); } finally { busy = false; } }
$('login').onsubmit = e => { e.preventDefault(); perform(async () => { key = $('token').value; await refresh(); $('token').value = ''; $('access').hidden = true; $('workspace').hidden = false; notice('Đã kết nối dịch vụ.'); }); };
$('logout').onclick = () => location.reload();
$('add').onclick = addOrder; $('refresh').onclick = () => perform(refresh);
$('create').onsubmit = e => { e.preventDefault(); perform(async () => {
  const orders = [...$('orders').children].map(row => Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.value])));
  if (!orders.length) throw Error('Hãy nhập ít nhất một lệnh.');
  if (!confirm('Chốt sổ lệnh? Sau khi lưu, các lệnh trong phiên này không thể sửa.')) return;
  const r = await api('batches', { name: $('name').value, mode: $('mode').value, feeBps: Number($('fee').value), orders }); selected = r.id; await refresh(); notice('Đã chốt sổ lệnh. Chọn Chạy trên X Layer để bắt đầu.');
}); };
$('run').onclick = () => perform(async () => { if (!current || !confirm('Bắt đầu thực thi? Phiên có thể mất vài phút hoặc lâu hơn tùy số lệnh và RPC. Không chuyển token.')) return; await api('batches/' + current.id + '/run', { revision: current.revision }); await refresh(); });
$('download').onclick = () => { if (!current?.result) return; const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })); const a = element('a'); a.href = url; a.download = 'LotGate-' + current.id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
setInterval(() => { if (key && !$('workspace').hidden && !document.hidden) perform(refresh); }, 5000);
addOrder(); addOrder();

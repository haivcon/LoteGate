import { Session } from '/src/session.mjs';
import { verifyResult } from '/src/verify.mjs';
const $ = id => document.getElementById(id), json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2);
let session, orders, options, report;
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function render() {
  const s = session?.snapshot();
  $('state').textContent = !s ? 'Chưa khởi tạo' : s.done ? 'Đã kết thúc' : 'Đang chạy';
  $('volume').textContent = String(s?.volume ?? 0); $('price').textContent = String(s?.clearingPrice ?? 0); $('steps').textContent = String(s?.trace.length ?? 0);
  $('priceLabel').textContent = s?.done ? 'Giá chung cuối cùng' : 'Giá chung tạm thời';
  $('heads').textContent = s ? `Mua: ${s.currentBuy ?? '—'} / Bán: ${s.currentSell ?? '—'}` : 'Chưa có cặp lệnh được nạp.';
  $('rows').replaceChildren(); $('trace').replaceChildren();
  for (const row of s?.rows ?? []) {
    const tr = document.createElement('tr');
    for (const key of ['id', 'side', 'price', 'quantity', 'filled', 'remaining']) { const td = document.createElement('td'); td.textContent = String(row[key]); if (key === 'side') td.className = row.side; tr.append(td); }
    $('rows').append(tr);
  }
  for (const t of s?.trace ?? []) { const li = document.createElement('li'); li.textContent = `${t.buyId} ↔ ${t.sellId} · ${t.fill} lot`; $('trace').append(li); }
  $('step').disabled = $('run').disabled = !s || s.done;
  for (const id of ['orders', 'mode', 'fee', 'init', 'add']) $(id).disabled = Boolean(s);
  $('export').disabled = !report;
  $('report').textContent = report ? json(report) : 'Chỉ khả dụng khi phiên kết thúc.';
}
function finish() {
  if (session.done) {
    const result = session.result(); verifyResult(orders, result, options);
    report = { mode: 'LOCAL NAND simulation; no RPC or assets', options, orders, result, independentlyVerified: true };
    status('Đã kết thúc · oracle độc lập xác nhận phân bổ, ưu tiên và bảo toàn.');
  } else status('Nhịp đã chạy. Giá hiển thị chưa phải giá quyết toán.');
  render();
}
function safe(fn) { return async () => { try { await fn(); } catch (e) { status(e.message, true); } }; }
$('init').onclick = safe(() => { orders = JSON.parse($('orders').value); options = { mode: $('mode').value, feeBps: Number($('fee').value) }; session = new Session(orders, options); report = null; render(); status('Cấu hình đã chốt. Sẵn sàng chạy mạch.'); });
$('step').onclick = safe(() => { session.step(); finish(); });
$('run').onclick = safe(async () => {
  $('step').disabled = $('run').disabled = $('reset').disabled = true;
  try { while (!session.done) { session.step(); await new Promise(resolve => setTimeout(resolve, 0)); } finish(); }
  finally { $('reset').disabled = false; render(); }
});
$('reset').onclick = () => { session = null; report = null; render(); status('Đã đặt lại. Có thể chỉnh cấu hình.'); };
$('add').onclick = safe(() => { const rows = JSON.parse($('orders').value); rows.push({ id: `order-${rows.length + 1}`, side: 'buy', price: '10', quantity: '100' }); $('orders').value = json(rows); });
$('export').onclick = () => { const url = URL.createObjectURL(new Blob([json(report)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'LotGate-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
try { const response = await fetch('/orders.json'); if (!response.ok) throw new Error('Không tải được ví dụ'); $('orders').value = json(await response.json()); status('Chỉnh lệnh hoặc khởi tạo phiên mẫu.'); } catch (e) { status(e.message, true); }
render();

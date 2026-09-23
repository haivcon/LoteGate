# LotGate — TapeOut batch auctions on X Layer

LotGate là ứng dụng đấu giá theo lô dành cho một operator: nhập lệnh → khóa đầu vào → xếp hàng thực thi qua CPU TapeOut trên X Layer → kiểm tra phân bổ → xuất receipt JSON.

**Phạm vi: tính toán, không custody và không chuyển tài sản.** `eth_call` không lưu trạng thái phiên lên blockchain. Backend quản lý đầu vào và state giữa các lần gọi; không có local fallback trong đường chạy Operator.

## Chạy để chấm điểm

Yêu cầu **Node.js >=22**, npm và kết nối HTTPS tới RPC. Không cần ví, private key hay cài thêm runtime dependency.

```sh
git clone https://github.com/haivcon/LoteGate.git
cd LoteGate
```

PowerShell:

```powershell
$env:LOTGATE_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:LOTGATE_TOKEN # copy vào màn hình đăng nhập; không chia sẻ công khai
npm start
```

macOS/Linux:

```sh
export LOTGATE_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
printf '%s\n' "$LOTGATE_TOKEN"
npm start
```

Mở **http://127.0.0.1:4173**, nhập token, tạo batch, thêm lệnh mua giá 20 số lượng 3 và lệnh bán giá 10 số lượng 3, khóa lệnh rồi chạy. Kỳ vọng giá khớp 10, volume 3. Dữ liệu phiên nằm trong thư mục `data/` (không commit).

**Thực thi live có thể mất nhiều phút**, không phải giao dịch tức thời. Không gửi tiền thật.

## Kiến trúc và circuit

- `web/operator/`: giao diện tiếng Việt, tạo/chạy phiên và tải receipt.
- `scripts/operator-server.mjs`: HTTP API có xác thực, origin check và giới hạn request.
- `scripts/batch-service.mjs`: hàng đợi tuần tự, revision, lưu đĩa, single-writer lock, idempotency API.
- `src/async-session.mjs`, `scripts/xlayer-runtime.mjs`: thực thi async, state CPU trả về được dùng cho RPC kế tiếp; kiểm tra bytes/dimensions circuit tại block cố định.
- `src/verify.mjs`: oracle kiểm kết quả, bảo toàn khối lượng và giới hạn giá.
- `circuits/serial/`: ba artifact runtime đang dùng (BLIF, binary và manifest).
- `deployment/xlayer.json`: định danh triển khai công khai. Các ghi chú verification trong file là lịch sử, không phải chứng nhận độc lập.

X Layer chain **196**, CPU **`0xAa13ae45b0B2D52f210Ad7Ef12997113a0ebAF21`**. Circuit refund **#1**, multiplier serial **#2**, controller serial **#3**. RPC runtime mặc định `https://tapeout.net/rpc-xlayer`; có thể đổi bằng biến `XLAYER_RPC`.

Mua xếp giá giảm dần, bán tăng dần; cùng giá ưu tiên thứ tự nhập. Giá gross thống nhất là giá giới hạn seller cuối đã khớp. Giá/số lượng là số nguyên lot/tick, không phải số thập phân token. Phí seller làm tròn xuống theo từng lệnh.

## Kiểm thử và tái lập

`npm run verify` chạy test Operator, quy tắc đấu giá, receipt và checksum artifact mà không cần parser hoặc RPC. Mô hình arithmetic trong `src/reference-controller.mjs` chỉ dùng để đối chiếu test/benchmark, không phải fallback của Operator.

Chỉ tái tạo/đối chiếu bản build (`npm run generate:serial`, `npm run check:serial`) mới cần parser TapeOut bên ngoài đã review, SHA-256:

```text
a794be064f8a0e1317f2de4ed909cc397f24a6836c048a881b124afffdf42084
```

Parser phải export `parse`, `expand`, `compile`, `decode`, `encode`, `limits`. Bản sao bên thứ ba **không được đóng gói** vì chưa xác nhận quyền phân phối; cần lấy đúng snapshot từ người nộp dự án hoặc nhà cung cấp TapeOut qua kênh được phép. Đây là hạn chế tái lập hiện tại. Operator dùng binary đã commit và không cần parser này để khởi động/chạy RPC.

```powershell
$env:TAPEOUT_PARSER = 'path/to/reviewed-parser.mjs'
npm run verify
npm run check:serial
```

```sh
export TAPEOUT_PARSER=/path/to/reviewed-parser.mjs
npm run verify
npm run check:serial
```

Benchmark live (gọi RPC, không broadcast transaction): `node scripts/benchmark-operator.mjs 2`. Báo cáo được ghi vào `reports/`, không commit. Xác minh receipt: `node scripts/verify-receipt.mjs path/to/receipt.json`.


## Ranh giới tin cậy / chưa hoàn thành

Receipt kiểm hash và arithmetic, **không** chứng minh chữ ký người đặt lệnh, tính đầy đủ của intake, RPC thực sự đã chạy hay thanh toán. Operator và filesystem vẫn được tin cậy. Chưa có tài khoản riêng, cancellation hoặc audit log đầy đủ; UI chưa gửi `requestId` dù API đã hỗ trợ.

Queued jobs được khôi phục; job đang chạy khi dừng trở thành INTERRUPTED và cần retry. Không xóa stale lock khi chưa xác nhận tiến trình cũ đã dừng. Cần nghiệm thu crash recovery, browser Operator, tải đại diện, backup/restore, HTTPS, supervision và provenance trước production.

Chi tiết: [Operator](OPERATOR.md), [Operating model](OPERATING-MODEL.md). Repository chỉ giữ ứng dụng Operator, ba circuit đang dùng và công cụ kiểm tra trực tiếp liên quan.

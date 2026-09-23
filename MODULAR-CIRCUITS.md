# LotGate — bộ BLIF chức năng độc lập

Gốc: `<repository>`

## Kết quả đo bằng parser TapeOut khóa checksum

| BLIF trong circuits/modular | Byte BLIF | Byte netlist |
|---|---:|---:|
| price_check32.blif | 13866 | 9240 |
| quantity_min32.blif | 17214 | 11690 |
| sub32.blif | 11457 | 7637 |
| add32_carry.blif | 10870 | 7406 |
| mul8x8.blif | 22436 | 17038 |
| refund64.blif | 27901 | 17948 |

Cả văn bản UTF-8 BLIF và netlist đều dưới 34000 byte. Không REF, không latch, không cần deploy parent. Manifest có thứ tự chân, độ rộng, SHA256 và parserHash. Đây là kết quả parser local; chưa xác nhận import canvas hiện hành hay deploy X Layer.

Thư mục cần dùng: `<repository>\circuits\modular`.
Import từng file BLIF riêng, không nối chúng thành một file lớn. Import/deploy riêng KHÔNG khiến các circuit tự điều phối với nhau.

## Giao thức

Tất cả trường unsigned, LSB trước; xem manifest để đóng gói input/output.
- price_check32(a:uint32,b:uint32): valid=(a!=0 && b!=0), crossing=(a>=b).
- quantity_min32(a:uint32,b:uint32): valid tương tự, value=min(a,b), kể cả khi valid=0.
- sub32(a:uint32,b:uint32): value=(a-b) modulo 2^32, borrow=(a<b).
- add32_carry(a:uint32,b:uint32,cin:bit): value=(a+b+cin) modulo 2^32, carry là bit tràn.
- mul8x8(a:uint8,b:uint8): value:uint16=a*b.
- refund64(deposit:uint64,payment:uint64): underflow nếu payment>deposit, refund=0 khi underflow, còn lại deposit-payment.

Bộ điều phối giữ volume:uint64, price:uint32, done/error. Kiểm giá/lượng, tính lượng khớp, gọi sub32 hai lần, cộng volume qua hai lần add32_carry. Chỉ cập nhật state sau khi mọi lời gọi hoàn tất. Giữ hành vi controller cũ, gồm output modulo khi overflow và error khóa việc sử dụng kết quả; output nhịp lỗi không được quyết toán. Session ném lỗi trước khi cập nhật danh sách lệnh.

Bộ nhân thay kế hoạch 16-bit tuần tự bằng 8-bit tổ hợp: 16 tích từng phần, mỗi tích dịch đúng vị trí rồi cộng qua add32_carry hai lần. Vẫn chính xác 32x32 -> 64, tránh handshake/latch giữa các lần gọi. Chi phí mỗi phép nhân hiện là 16 lời gọi mul8x8 + 32 lời gọi add32_carry; không tuyên bố tối ưu gas.

State/branch/reset/enable, danh tính, chọn đầu lệnh, sort, phí và tổng phí nằm ở host. Không phải toàn bộ controller trên một circuit. Không có bảo đảm on-chain về chuỗi dữ liệu giữa các mạch; chưa có adapter CPU TapeOut hoặc hợp đồng điều phối tài sản thật.

## Chạy

```powershell
Set-Location '<repository>'
$env:TAPEOUT_PARSER='<reviewed-parser-path>'
node scripts/modular.mjs
npm run verify
node scripts/demo-modular.mjs
npm start
```

Session/UI mặc định mô phỏng các mạch nguồn modular; demo-modular thực thi netlist biên dịch từ BLIF. Test so sánh cả hai backend với oracle số học độc lập. Đường legacy đã bỏ; oracle tick hiện là số học độc lập.

Bản modular-only hiện đạt 9/9 test, kiểm artifact và browser local (step/run, khóa cấu hình, export, mobile, dữ liệu lỗi, không page error). Log ở <repository>\reports\cleanup-verify.log và <repository>\reports\cleanup-browser.log. Browser test này KHÔNG phải test tapeout.net. Đã chạy lại EVM sandbox với sub32; không phải TapeOut CPU. Chưa đo gas TapeOut/triển khai.


## Phiên bản hiện hành và khôi phục
Các file cũ đã chuyển khỏi cây dự án chính. Xem <repository>\CLEANUP-NOTES.md. generate/check/demo chỉ dùng modular. Phiên lỗi backend bị khóa; output backend được kiểm kiểu/độ rộng, nhưng chưa xác thực nguồn dữ liệu on-chain.

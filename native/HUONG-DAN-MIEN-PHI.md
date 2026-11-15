# Cài TASCO DLK lên iPhone miễn phí (không cần trả 99 USD)

Dùng cho **một vài người**. Cách này dùng Apple ID thường để tự ký app, nên có hai giới hạn của Apple:
- App **hết hạn sau 7 ngày** và phải nạp lại (làm lại phần "Nạp vào iPhone", mất khoảng 1 phút).
- Tối đa **3 app nạp ngoài** cùng lúc trên một iPhone.

Muốn cho cả nhóm cài qua link, không hết hạn: dùng TestFlight (xem `HUONG-DAN-TESTFLIGHT.md`).

## Chuẩn bị (làm một lần)
1. **Máy tính** Windows hoặc Mac, có cáp USB nối iPhone.
2. Cài **Sideloadly** từ https://sideloadly.io (làm theo hướng dẫn trên trang đó; trên Windows cần iTunes và iCloud bản tải từ Apple).
3. Nên tạo **Apple ID phụ** (miễn phí tại https://account.apple.com) chỉ để nạp app, để tài khoản chính và dữ liệu iCloud không bị liên quan.
4. Trên iPhone bật **Chế độ nhà phát triển**: Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển → Bật → khởi động lại máy.

## Tạo và tải file app
1. Vào GitHub repo → tab **Actions** → **iOS IPA miễn phí** → **Run workflow**. Chờ khoảng 5 phút.
2. Tải file **TASCO-DLK.ipa** ở trang Releases: https://github.com/huyho711997-lgtm/tra-cuu-phu-tung/releases/tag/ios-latest

## Nạp vào iPhone
1. Nối iPhone vào máy tính bằng cáp, bấm **Tin cậy** (Trust) trên iPhone.
2. Mở Sideloadly, kéo file `TASCO-DLK.ipa` vào cửa sổ, chọn đúng iPhone ở mục thiết bị.
3. Nhập Apple ID (nên dùng Apple ID phụ) rồi bấm **Start**. Nhập mã xác minh 2 lớp nếu được hỏi.
4. Trên iPhone: Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → chọn Apple ID của bạn → **Tin cậy**.
5. Mở app **TASCO DLK**, cho phép camera và vị trí **một lần**. iOS sẽ nhớ, không hỏi lại mỗi lần mở.

## Hằng tuần
- Trước khi hết 7 ngày, nối iPhone vào máy tính và nạp lại đúng file đó bằng cùng Apple ID (Sideloadly ghi đè bản cũ). Có thể bật tùy chọn tự làm mới của Sideloadly, nhưng máy tính phải mở và cùng mạng.
- Khi có bản mới của app: chạy lại workflow, tải file mới rồi nạp như trên.

## Nếu gặp lỗi
- "Developer Mode required": làm lại bước 4 phần Chuẩn bị.
- Báo đạt giới hạn 3 app hoặc giới hạn số App ID trong tuần: xóa bớt app nạp ngoài, hoặc đợi vài ngày, hoặc dùng Apple ID khác.
- Chụp màn hình lỗi và gửi lại để được sửa.

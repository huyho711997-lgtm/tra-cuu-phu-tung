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

## Cập nhật nội dung app
App chỉ là "vỏ" iOS, mỗi lần mở nó tải trang web mới nhất từ GitHub Pages. Vì vậy **sửa code xong là app tự có bản mới**, không cần nạp lại file IPA.
- GitHub Pages giữ cache khoảng 10 phút. Nếu chưa thấy thay đổi: vào **Tài khoản → Cập nhật ứng dụng** trong app.
- Chỉ cần nạp lại IPA khi đổi phần vỏ iOS (quyền, icon, plugin). Khi đó chạy workflow **iOS unsigned IPA**, tải file mới rồi nạp như trên.
- Cần có mạng khi mở app. Không có mạng, app hiện màn hình "Chưa kết nối được" kèm nút Thử lại.
- Lần đầu mở bản này bạn sẽ phải đăng nhập lại một lần (địa chỉ tải trang đã đổi nên phiên cũ không dùng chung).

## Nếu gặp lỗi
- "Developer Mode required": làm lại bước 4 phần Chuẩn bị.
- Báo đạt giới hạn 3 app hoặc giới hạn số App ID trong tuần: xóa bớt app nạp ngoài, hoặc đợi vài ngày, hoặc dùng Apple ID khác.
- Chụp màn hình lỗi và gửi lại để được sửa.

## Khoá ứng dụng bằng Face ID (từ bản IPA có plugin NativeBiometric)

- Vào **Tài khoản → Thiết lập cá nhân → Mở khoá bằng Face ID** để bật. Cần iPhone đã bật Face ID (hoặc ít nhất mật mã khoá máy).
- Chọn **Khoá lại sau** 30 giây / 2 phút / 10 phút: rời app lâu hơn mức này thì khi quay lại phải mở khoá.
- Face ID lỗi sẽ có mật mã máy làm phương án dự phòng. Nếu iPhone tắt hẳn Face ID và mật mã, app tự tắt khoá để không bị kẹt.
- Dòng cài đặt chỉ hiện trong app iOS; bản IPA cũ (chưa có plugin) hiển thị "Cần cài bản app mới".

## Nói để nhập hạng mục (cần cài IPA mới)
- Bản IPA mới có thêm plugin nhận dạng giọng nói của iOS (miễn phí, không cần mạng bên thứ ba) và quyền `NSSpeechRecognitionUsageDescription`.
- Trong ô thêm hạng mục (camera / đổi hạng mục) bấm biểu tượng micro, đọc tên các mục, nói "phẩy" giữa các mục, rồi bấm Thêm.
- Lần đầu iOS hỏi quyền Micro và Nhận dạng giọng nói: chọn Cho phép. Nếu lỡ từ chối, vào Cài đặt iPhone → TASCO DLK để bật lại.

## Camera xoay ngang thật (cần cài IPA mới)
- Bản IPA mới có thêm plugin xoay màn hình. Ngoài camera app luôn giữ dọc; khi mở camera, cầm ngang thì màn hình camera tự xoay ngang, hình live thẳng đứng, khung 4:3 nằm bên cạnh cột nút chụp.
- Nút **khoá chụp ngang** (icon điện thoại ngang + ổ khoá): bật thì camera luôn ngang, cầm máy sang bên ngang kia khung tự lật theo; ảnh chụp ra đúng như khung đang xem. Rời camera thì app về dọc.
- Nếu cài bản app cũ (chưa có plugin) camera vẫn dọc như trước, chỉ xoay biểu tượng.

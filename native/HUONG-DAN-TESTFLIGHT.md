# Cài TASCO DLK lên iPhone qua TestFlight (không cần App Store, không cần Mac)

Thư mục `native/` bọc `mobile.html` thành app iOS thật (Capacitor). Mỗi lần bấm **Run workflow**, GitHub tự build trên máy Mac đám mây và đẩy bản mới lên TestFlight.

## Bạn cần làm (một lần duy nhất)

### Bước 1. Đăng ký Apple Developer Program (khoảng 99 USD/năm)
1. Vào https://developer.apple.com/programs/enroll/ và đăng nhập bằng Apple ID của bạn.
2. Chọn **Individual** (cá nhân) cho nhanh, thường duyệt trong 1–2 ngày. Chọn **Organization** nếu muốn đứng tên công ty (cần mã D-U-N-S, lâu hơn).
3. Thanh toán và chờ Apple xác nhận qua email.

### Bước 2. Lấy Team ID
1. Vào https://developer.apple.com/account → mục **Membership details**.
2. Chép dòng **Team ID** (10 ký tự, ví dụ `A1B2C3D4E5`). Đây là secret `APPLE_TEAM_ID`.

### Bước 3. Tạo app trên App Store Connect
1. Vào https://appstoreconnect.apple.com → **Apps** → dấu **+** → **New App**.
2. Platform: **iOS**. Name: `TASCO DLK` (nếu trùng tên thì thêm hậu tố, ví dụ `TASCO DLK Giám định`). Language: Vietnamese.
3. **Bundle ID**: chọn `vn.tascodlk.workspace`. Nếu chưa có trong danh sách, vào https://developer.apple.com/account/resources/identifiers → **+** → App IDs → App → nhập Bundle ID đó rồi quay lại.
   - Nếu Apple báo Bundle ID đã bị người khác dùng, đổi `appId` trong `native/capacitor.config.json` thành tên khác (ví dụ `vn.tascodlk.giamdinh`) và dùng tên đó ở đây.
4. SKU: gõ tùy ý (ví dụ `tasco-dlk-1`). Bấm **Create**.

> Bước này bắt buộc: nếu chưa có app cho Bundle ID thì việc tải lên TestFlight sẽ báo lỗi.

### Bước 4. Tạo khóa API và nhập vào GitHub
1. App Store Connect → **Users and Access** → tab **Integrations** → **App Store Connect API** → **Team Keys** → dấu **+**.
2. Tên: `GitHub TestFlight`. Quyền (Access): **Admin**. Bấm **Generate**.
3. Chép **Issuer ID** (ở đầu trang) và **Key ID** của khóa vừa tạo. Bấm **Download API Key** để tải file `AuthKey_XXXX.p8` (**chỉ tải được một lần**, hãy giữ kỹ).
4. Vào GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, tạo đúng 4 secret:

| Tên secret | Giá trị |
|---|---|
| `APPLE_TEAM_ID` | Team ID ở bước 2 |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_ID` | Key ID |
| `ASC_KEY_P8` | Mở file `.p8` bằng Notepad/TextEdit rồi dán **toàn bộ nội dung** (gồm cả dòng BEGIN và END) |

Tuyệt đối không gửi file `.p8` hay dán nội dung ra chat/email.

### Bước 5. Chạy build
1. GitHub repo → tab **Actions** → **iOS TestFlight** → **Run workflow** → **Run workflow**.
2. Chờ khoảng 10–15 phút. Dấu tích xanh nghĩa là đã tải lên Apple. Nếu báo đỏ, mở lần chạy đó, chép dòng lỗi gửi lại để được sửa.

### Bước 6. Mở cho nhân viên và gara cài (TestFlight)
1. App Store Connect → app của bạn → tab **TestFlight**. Chờ bản build chuyển từ "Processing" sang sẵn sàng (khoảng 5–15 phút).
2. Điền **Test Information** (mô tả beta, email phản hồi). Mục "What to Test" gợi ý: *Đăng nhập, tra cứu phụ tùng, chụp ảnh hồ sơ gara, lấy vị trí.* Nếu Apple yêu cầu tài khoản demo, tạo một tài khoản thử trong app và nhập vào.
3. Tạo nhóm **External Testing** → thêm build → bật **Public Link** → sao chép link.
4. Lần đầu, Apple sẽ duyệt bản beta (thường 1–2 ngày). Sau khi được duyệt, gửi link cho mọi người.
5. Người dùng: cài app **TestFlight** từ App Store → mở link → **Cài đặt**.

> Nhóm **Internal Testing** (tối đa 100 người, thêm họ vào App Store Connect với vai trò Developer/App Manager) không cần Apple duyệt, rất tiện để bạn tự thử trước.

## Cập nhật sau này
- Sửa `mobile.html` rồi push lên `main`, sau đó chạy lại **Run workflow**. Bản mới tự lên TestFlight, người dùng nhận thông báo cập nhật.
- Mỗi bản TestFlight chỉ dùng được **90 ngày**, nên cần tải bản mới trước khi hết hạn.
- Bản web trên GitHub Pages (`/tra-cuu-phu-tung/mobile`) vẫn hoạt động bình thường song song.

## Dành cho kỹ thuật
- `scripts/sync-web.mjs` chép `../mobile.html` thành `www/index.html` rồi `cap sync ios`.
- Định vị trong app dùng plugin native `@capacitor/geolocation` (đoạn `tascoNativeBridge` trong `mobile.html`), camera dùng `getUserMedia` của WebView, quyền do iOS nhớ vĩnh viễn.
- Ký tự động bằng khóa API (cloud signing), không cần chứng chỉ `.p12` hay Mac.

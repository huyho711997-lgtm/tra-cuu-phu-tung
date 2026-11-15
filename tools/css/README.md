# CSS biên dịch sẵn

`mobile.html` dùng `../../tailwind.css` (Flowbite + Tailwind đã biên dịch) thay cho Tailwind CDN chạy trên trình duyệt.
Nhờ vậy app mở nhanh hơn và vẫn đúng giao diện khi mất mạng.

- Thêm/đổi class Tailwind trong `mobile.html` thì cần biên dịch lại:
  `cd tools/css && npm ci && npm run build`
- Nếu quên, workflow **Build CSS** (`.github/workflows/build-css.yml`) tự biên dịch lại và commit `tailwind.css` lên `main`.
- Không ghép tên class bằng chuỗi động (ví dụ `'bg-' + mau`): Tailwind chỉ giữ class xuất hiện nguyên văn trong `mobile.html`.
- Màu `navy` và `teal` cấu hình trong `tailwind.config.js`.

## Phiên bản hiển thị trong app
App hiển thị thời điểm GitHub Pages triển khai trang (document.lastModified) trong **Tài khoản → Cập nhật ứng dụng**. Không cần commit đóng dấu.

**Trước khi push mobile.html, chạy `npm run build` ở đây và commit kèm tailwind.css** để workflow không phải tạo thêm commit (commit thêm làm bản triển khai Pages trước đó bị hủy, hiện dấu ✕).

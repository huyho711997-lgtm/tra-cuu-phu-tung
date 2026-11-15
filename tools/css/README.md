# CSS biên dịch sẵn

`mobile.html` dùng `../../tailwind.css` (Flowbite + Tailwind đã biên dịch) thay cho Tailwind CDN chạy trên trình duyệt.
Nhờ vậy app mở nhanh hơn và vẫn đúng giao diện khi mất mạng.

- Thêm/đổi class Tailwind trong `mobile.html` thì cần biên dịch lại:
  `cd tools/css && npm ci && npm run build`
- Nếu quên, workflow **Build CSS** (`.github/workflows/build-css.yml`) tự biên dịch lại và commit `tailwind.css` lên `main`.
- Không ghép tên class bằng chuỗi động (ví dụ `'bg-' + mau`): Tailwind chỉ giữ class xuất hiện nguyên văn trong `mobile.html`.
- Màu `navy` và `teal` cấu hình trong `tailwind.config.js`.

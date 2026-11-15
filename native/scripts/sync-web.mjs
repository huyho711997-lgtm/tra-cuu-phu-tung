// Chép web app (mobile.html + tài nguyên) vào www/ để Capacitor đóng gói vào app iOS.
import { cp, rm, mkdir, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');      // gốc repo
const www = path.resolve(here, '..', 'www');

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

const src = path.join(root, 'mobile.html');
if (!existsSync(src)) throw new Error('Không thấy mobile.html ở gốc repo: ' + src);
await copyFile(src, path.join(www, 'index.html'));          // Capacitor mở index.html
await copyFile(path.join(here, '..', 'offline.html'), path.join(www, 'offline.html'));  // trang báo lỗi khi mở app mà không có mạng
await copyFile(path.join(root, 'tailwind.css'), path.join(www, 'tailwind.css'));  // CSS biên dịch sẵn (tools/css)
await cp(path.join(root, 'icons'), path.join(www, 'icons'), { recursive: true });
// Capacitor iOS kiểm tra tệp www/<server.appStartPath> có trong gói trước khi mở app; thiếu là fatalLoadError (văng app).
// App tải trang thật từ server.url, tệp này chỉ để vượt qua bước kiểm tra đó.
const config = JSON.parse(await readFile(path.resolve(here, '..', 'capacitor.config.json'), 'utf8'));
const startPath = config.server?.appStartPath;
if (startPath) {
  const target = path.join(www, startPath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(src, target);
  console.log('Đã tạo www/' + startPath + ' cho bước kiểm tra appStartPath của Capacitor');
}
console.log('Đã chép mobile.html -> www/index.html và icons/');

// Chép web app (mobile.html + tài nguyên) vào www/ để Capacitor đóng gói vào app iOS.
import { cp, rm, mkdir, copyFile } from 'node:fs/promises';
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
await copyFile(path.join(root, 'tailwind.css'), path.join(www, 'tailwind.css'));  // CSS biên dịch sẵn (tools/css)
await cp(path.join(root, 'icons'), path.join(www, 'icons'), { recursive: true });
console.log('Đã chép mobile.html -> www/index.html và icons/');

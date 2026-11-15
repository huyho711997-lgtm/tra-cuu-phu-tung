// Tạo ../../tailwind.css = Flowbite CSS + Tailwind đã biên dịch (chỉ giữ class mobile.html thật sự dùng).
// Chạy: cd tools/css && npm install && npm run build
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', '..', 'tailwind.css');
const tw = path.join(here, 'node_modules', '.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
const tmp = path.join(here, '.tailwind.generated.css');

execFileSync(tw, ['-c', path.join(here, 'tailwind.config.js'), '-i', path.join(here, 'input.css'), '-o', tmp, '--minify'], { cwd: here, stdio: 'inherit' });
const flowbite = readFileSync(path.join(here, 'node_modules', 'flowbite', 'dist', 'flowbite.min.css'), 'utf8');
// Flowbite trước, Tailwind sau: đúng thứ tự cũ (CDN Tailwind chèn style sau cùng).
writeFileSync(out, flowbite.trim() + '\n' + readFileSync(tmp, 'utf8'));
console.log('Đã tạo tailwind.css —', (statSync(out).size / 1024).toFixed(1), 'KB');

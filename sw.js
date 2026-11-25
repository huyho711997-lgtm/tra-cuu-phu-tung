/* TASCO DLK service worker.
 * Mục tiêu: cho phép cài như ứng dụng và mở lại được khi mạng yếu, KHÔNG làm app bị "kẹt" bản cũ.
 *  - Trang/asset cùng origin: ưu tiên MẠNG (luôn lấy bản mới nhất), chỉ dùng cache khi mất mạng.
 *  - Thư viện CDN tĩnh (esm.sh, font): lấy từ cache trước, cập nhật ngầm.
 *  - Mọi thứ khác (Supabase, Cloudinary, API, POST...) đi thẳng ra mạng, KHÔNG bao giờ cache.
 * Đổi CACHE_VERSION khi cần buộc làm mới toàn bộ cache.
 */
const CACHE_VERSION = 'v3';
const SHELL_CACHE = 'tasco-shell-' + CACHE_VERSION;
const CDN_CACHE = 'tasco-cdn-' + CACHE_VERSION;
const SHELL_URLS = ['./mobile', './tailwind.css', './registration-ocr.js?v=models-ui-20261125', './registration-ocr.css?v=models-ui-20261125', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'];
const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll thất bại nếu 1 URL lỗi -> thêm từng cái để không chặn việc cài đặt.
    await Promise.all(SHELL_URLS.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, CDN_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('tasco-') && !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    // Chấp nhận response opaque (no-cors) của script/font CDN, nhưng bỏ qua lỗi.
    if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && /\/vendor\/[^/]+-\d+\.\d+\.\d+(\.min)?\.js$/.test(url.pathname)) {
    // Thư viện đóng gói có số phiên bản trong tên tệp: không bao giờ đổi nội dung -> lấy cache trước, mở app nhanh khi mạng yếu.
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (url.origin === self.location.origin) {
    // Chỉ xử lý trong phạm vi của SW; điều hướng thất bại -> trang mobile đã cache.
    event.respondWith(networkFirst(request, request.mode === 'navigate' ? './mobile' : null));
    return;
  }
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Còn lại: không can thiệp (Supabase, Cloudinary, API...).
});

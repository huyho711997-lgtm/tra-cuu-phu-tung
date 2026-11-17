/* TASCO DLK · Đánh dấu trên ảnh (mũi tên, vòng tròn, khung, số thứ tự, chữ).
 * Nét vẽ lưu riêng dạng JSON (toạ độ theo tỉ lệ 0..1 của ảnh), KHÔNG đụng tới ảnh gốc, nên xem ở mọi cỡ màn hình đều khớp.
 * Dùng chung cho trang Cloud máy tính (cloud.html) và app điện thoại (mobile.html).
 *
 *   TascoMarkup.sanitize(json)          -> {v:1, items:[...]} đã làm sạch (dữ liệu từ máy chủ không đáng tin)
 *   TascoMarkup.count(json)             -> số nét đánh dấu
 *   TascoMarkup.mount(svg, json, w, h)  -> vẽ lớp phủ (chỉ xem) lên một thẻ <svg> cùng khung với ảnh
 *   TascoMarkup.edit({url,annotations,title,save}) -> mở trình chỉnh sửa toàn màn hình, trả Promise<json|null>
 *   TascoMarkup.flatten(url, json)      -> Promise<Blob> ảnh JPG đã in sẵn đánh dấu (để tải về / chia sẻ)
 */
(function () {
  'use strict';
  if (window.TascoMarkup) return;
  var W = 1000, MAX_ITEMS = 80;
  var COLORS = ['#ef3b4f', '#ff9f1c', '#ffd60a', '#2ec27e', '#2f80ed', '#ffffff'];
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var num = function (v) { v = Number(v); return isFinite(v) ? clamp(v, -0.05, 1.05) : 0; };
  var colorOk = function (c) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toLowerCase() : COLORS[0]; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var uid = function () { return Math.random().toString(36).slice(2, 8); };
  var FONT = "'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";

  function sanitize(a) {
    var out = [];
    if (a && typeof a === 'object' && Array.isArray(a.items)) {
      a.items.slice(0, MAX_ITEMS).forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        var t = it.t, c = colorOk(it.c), id = String(it.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 12) || uid();
        if (t === 'a' || t === 'o' || t === 'r') out.push({ id: id, t: t, c: c, x1: num(it.x1), y1: num(it.y1), x2: num(it.x2), y2: num(it.y2) });
        else if (t === 'n') out.push({ id: id, t: t, c: c, x: num(it.x), y: num(it.y), n: clamp(parseInt(it.n, 10) || 1, 1, 999) });
        else if (t === 'x' && typeof it.s === 'string' && it.s.trim()) out.push({ id: id, t: t, c: c, x: num(it.x), y: num(it.y), s: it.s.replace(/\s+/g, ' ').trim().slice(0, 120) });
      });
    }
    return { v: 1, items: out };
  }
  function count(a) { return sanitize(a).items.length; }

  /* ---------- Vẽ một nét thành chuỗi SVG ---------- */
  function shapeSVG(it, H, edit) {
    var X = function (v) { return +(v * W).toFixed(1); }, Y = function (v) { return +(v * H).toFixed(1); }, c = it.c;
    var attr = edit ? ' data-id="' + it.id + '"' : '';
    var halo = 'fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"';
    var line = 'fill="none" stroke="' + c + '" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"';
    var hit = function (d) { return edit ? '<path d="' + d + '" fill="none" stroke="#000" stroke-opacity="0" stroke-width="44" stroke-linecap="round" class="mk-hit"/>' : ''; };
    var x1, y1, x2, y2, d;
    if (it.t === 'a') {
      x1 = X(it.x1); y1 = Y(it.y1); x2 = X(it.x2); y2 = Y(it.y2);
      var ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1), L = Math.min(52, Math.max(24, len * 0.38)), s = Math.PI * 0.87;
      d = 'M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + 'M' + (x2 + L * Math.cos(ang + s)).toFixed(1) + ' ' + (y2 + L * Math.sin(ang + s)).toFixed(1) + 'L' + x2 + ' ' + y2 + 'L' + (x2 + L * Math.cos(ang - s)).toFixed(1) + ' ' + (y2 + L * Math.sin(ang - s)).toFixed(1);
      return '<g' + attr + '><path d="' + d + '" ' + halo + '/><path d="' + d + '" ' + line + '/>' + hit(d) + '</g>';
    }
    if (it.t === 'o' || it.t === 'r') {
      var lx = Math.min(it.x1, it.x2), rx = Math.max(it.x1, it.x2), ty = Math.min(it.y1, it.y2), by = Math.max(it.y1, it.y2);
      var cx = X((lx + rx) / 2), cy = Y((ty + by) / 2), w = Math.max(6, X(rx) - X(lx)), h = Math.max(6, Y(by) - Y(ty));
      var shape = it.t === 'o' ? function (extra) { return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (w / 2).toFixed(1) + '" ry="' + (h / 2).toFixed(1) + '" ' + extra + '/>'; }
        : function (extra) { return '<rect x="' + (cx - w / 2).toFixed(1) + '" y="' + (cy - h / 2).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="8" ' + extra + '/>'; };
      return '<g' + attr + '>' + shape(halo) + shape(line) + (edit ? shape('fill="none" stroke="#000" stroke-opacity="0" stroke-width="40" class="mk-hit"') : '') + '</g>';
    }
    if (it.t === 'n') {
      var px = X(it.x), py = Y(it.y), dark = c === '#ffd60a' || c === '#ffffff';
      return '<g' + attr + '><circle cx="' + px + '" cy="' + py + '" r="25" fill="' + c + '" stroke="' + (dark ? '#10233d' : '#fff') + '" stroke-width="4.5"/><text x="' + px + '" y="' + py + '" text-anchor="middle" dominant-baseline="central" font-family="' + FONT + '" font-weight="800" font-size="' + (it.n > 99 ? 20 : 27) + '" fill="' + (dark ? '#10233d' : '#fff') + '">' + it.n + '</text>' + (edit ? '<circle cx="' + px + '" cy="' + py + '" r="34" fill="#000" fill-opacity="0" stroke="none" class="mk-hit"/>' : '') + '</g>';
    }
    if (it.t === 'x') {
      var tx = X(it.x), ty2 = Y(it.y), tw = Math.max(40, it.s.length * 18), shadow = c === '#ffffff' ? '#10233d' : '#ffffff';
      return '<g' + attr + '><text x="' + tx + '" y="' + ty2 + '" font-family="' + FONT + '" font-weight="800" font-size="34" fill="' + c + '" stroke="' + shadow + '" stroke-width="8" stroke-linejoin="round" paint-order="stroke" style="paint-order:stroke">' + esc(it.s) + '</text>' + (edit ? '<rect x="' + tx + '" y="' + (ty2 - 34) + '" width="' + tw + '" height="46" fill="#000" fill-opacity="0" stroke="none" class="mk-hit"/>' : '') + '</g>';
    }
    return '';
  }
  function allSVG(items, H, edit) { return items.map(function (it) { return shapeSVG(it, H, edit); }).join(''); }

  /* Lớp phủ chỉ xem: svg đặt cùng khung với ảnh (viewBox theo tỉ lệ ảnh, meet = khớp object-fit:contain) */
  function mount(svg, json, w, h) {
    if (!svg) return 0;
    var a = sanitize(json), ratio = (Number(w) > 0 && Number(h) > 0) ? h / w : 0.75, H = W * ratio;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H.toFixed(2)); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = allSVG(a.items, H, false); svg.dataset.count = String(a.items.length);
    return a.items.length;
  }

  /* ---------- Ảnh đã in sẵn đánh dấu ---------- */
  async function flatten(url, json, maxSide) {
    var a = sanitize(json), res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Không tải được ảnh gốc.');
    var bmp = await createImageBitmap(await res.blob()), s = Math.min(1, (maxSide || 3200) / Math.max(bmp.width, bmp.height));
    var cw = Math.round(bmp.width * s), ch = Math.round(bmp.height * s), canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d'); ctx.drawImage(bmp, 0, 0, cw, ch); if (bmp.close) bmp.close();
    if (a.items.length) {
      var H = W * ch / cw, svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cw + '" height="' + ch + '" viewBox="0 0 ' + W + ' ' + H.toFixed(2) + '">' + allSVG(a.items, H, false) + '</svg>';
      var img = new Image(); img.decoding = 'async';
      await new Promise(function (ok, bad) { img.onload = ok; img.onerror = function () { bad(new Error('Không in được đánh dấu lên ảnh.')); }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      ctx.drawImage(img, 0, 0, cw, ch);
    }
    return new Promise(function (ok, bad) { canvas.toBlob(function (b) { b ? ok(b) : bad(new Error('Không tạo được ảnh.')); }, 'image/jpeg', 0.92); });
  }

  /* ---------- Trình chỉnh sửa ---------- */
  var STYLE_ID = 'tascoMarkupStyles';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '.mk{position:fixed;inset:0;z-index:2147483200;display:flex;flex-direction:column;background:#040d18;color:#e6f1f8;font-family:' + FONT + ';-webkit-user-select:none;user-select:none;animation:mkin .18s ease-out}',
      '@keyframes mkin{from{opacity:0}to{opacity:1}}',
      '.mk [hidden]{display:none!important}',
      '.mk *{box-sizing:border-box}:where(.mk) button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}.mk button:disabled{opacity:.38;cursor:default}',
      '.mk-top{flex:none;display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;background:linear-gradient(180deg,#0c1d33,#09182b);border-bottom:1px solid rgba(255,255,255,.08)}',
      '.mk-title{flex:1;min-width:0;font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:#b9cfe1}',
      '.mk-ico{width:40px;height:40px;border-radius:50%;display:grid;place-items:center}.mk-ico:hover:not(:disabled){background:rgba(255,255,255,.1)}',
      '.mk-ico svg,.mk-tool svg,.mk-act svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
      '.mk-btn{height:38px;padding:0 15px;border-radius:12px;font-size:13.5px;font-weight:700;color:#d6e6f2;background:rgba(255,255,255,.08)}.mk-btn:hover:not(:disabled){background:rgba(255,255,255,.16)}',
      '.mk-btn.go{background:linear-gradient(180deg,#a7e0e6,#7fc2cb);color:#06141f}.mk-btn.warn{background:#7a2433;color:#fff}',
      '.mk-stage{flex:1;min-height:0;position:relative;display:grid;place-items:center;overflow:hidden;background:radial-gradient(900px 600px at 50% 45%,#0c2038,#040d18 72%)}',
      '.mk-frame{position:relative;touch-action:none;box-shadow:0 30px 80px -20px rgba(0,0,0,.8);border-radius:4px;overflow:visible}',
      '.mk-frame img{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;-webkit-user-drag:none;border-radius:4px}',
      '.mk-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;touch-action:none}',
      '.mk[data-tool="a"] .mk-svg,.mk[data-tool="o"] .mk-svg,.mk[data-tool="r"] .mk-svg,.mk[data-tool="n"] .mk-svg,.mk[data-tool="x"] .mk-svg{cursor:crosshair}',
      '.mk[data-tool="select"] .mk-svg [data-id]{cursor:move}',
      '.mk-text{position:absolute;z-index:3;min-width:140px;max-width:80%;height:40px;padding:0 12px;border-radius:10px;border:2px solid #8fd0d8;background:rgba(8,18,31,.92);color:#fff;font:700 16px ' + FONT + ';outline:0;-webkit-user-select:text;user-select:text}',
      '.mk-msg{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:88%;padding:10px 14px;border-radius:12px;background:#4a1c27;border:1px solid rgba(229,86,109,.5);font-size:13px;font-weight:600;text-align:center;z-index:4}',
      '.mk-load{position:absolute;inset:0;display:grid;place-items:center;font-size:14px;font-weight:600;color:#8ea6b5;pointer-events:none}',
      '.mk-bar{flex:none;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));background:linear-gradient(180deg,#09182b,#0c1d33);border-top:1px solid rgba(255,255,255,.08);display:grid;gap:10px}',
      '.mk-tools{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;width:100%;max-width:560px;margin:0 auto}',
      '.mk-tool{min-width:0;display:grid;justify-items:center;gap:3px;padding:7px 8px;border-radius:13px;font-size:11px;font-weight:700;color:#9fb6c9}',
      '.mk-tool:hover{background:rgba(255,255,255,.07);color:#fff}.mk-tool.on{background:rgba(143,208,216,.2);color:#a7e0e6}',
      '.mk-row{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}',
      '.mk-colors{display:flex;gap:10px;align-items:center}',
      '.mk-dot{width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,.35);box-shadow:0 0 0 0 rgba(143,208,216,.0);transition:transform .12s,box-shadow .12s}',
      '.mk-dot.on{transform:scale(1.15);border-color:#fff;box-shadow:0 0 0 3px rgba(143,208,216,.7)}',
      '.mk-acts{display:flex;gap:6px}.mk-act{height:36px;padding:0 12px;border-radius:11px;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#d6e6f2;background:rgba(255,255,255,.08)}',
      '.mk-act:hover:not(:disabled){background:rgba(255,255,255,.16)}.mk-act.danger{color:#ffb4bf}.mk-act svg{width:17px;height:17px}',
      '.mk-hint{font-size:12px;font-weight:600;color:#7f98ad;text-align:center}',
      '.mk-tool span{white-space:nowrap}','@media(max-width:560px){.mk-tool{font-size:10px;padding:7px 1px}.mk-act span{display:none}.mk-act{padding:0 11px}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  var IC = {
    close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    select: '<svg viewBox="0 0 24 24"><path d="m5 3 14 8-6 1.8L10.5 19z"/></svg>',
    a: '<svg viewBox="0 0 24 24"><path d="M5 19 19 5M19 5h-8M19 5v8"/></svg>',
    o: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8.5" ry="6"/></svg>',
    r: '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="13" rx="2"/></svg>',
    n: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M10.5 9.8 12.4 8.6V16"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.8 7l.8 11.2a2 2 0 0 0 2 1.8h4.8a2 2 0 0 0 2-1.8L17.2 7"/></svg>',
    clear: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5"/></svg>'
  };
  var TOOLS = [['select', 'Chọn'], ['a', 'Mũi tên'], ['o', 'Vòng tròn'], ['r', 'Khung'], ['n', 'Đánh số'], ['x', 'Chữ']];
  var HINTS = { select: 'Chạm một nét để chọn, kéo để di chuyển, kéo chấm tròn để chỉnh.', a: 'Kéo từ gốc đến chỗ cần chỉ.', o: 'Kéo để khoanh vùng hư hỏng.', r: 'Kéo để vẽ khung.', n: 'Chạm vào ảnh để đặt số thứ tự.', x: 'Chạm vào ảnh rồi gõ chú thích.' };

  function edit(opt) {
    ensureStyle();
    return new Promise(function (resolve) {
      var items = sanitize(opt.annotations).items, base = JSON.stringify(items), undo = [], sel = '', tool = 'a', color = COLORS[0], drag = null, draft = null, aspect = 0.75, H = W * aspect, closing = false, saving = false, discardTimer = 0, textBox = null;
      var root = document.createElement('div'); root.className = 'mk'; root.dataset.tool = tool; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Đánh dấu ảnh');
      root.innerHTML = '<header class="mk-top"><button class="mk-ico" data-a="close" aria-label="Đóng">' + IC.close + '</button><div class="mk-title"></div><button class="mk-btn" data-a="undo" disabled>Hoàn tác</button><button class="mk-btn go" data-a="save" disabled>Lưu</button></header>' +
        '<div class="mk-stage"><div class="mk-frame" hidden><img alt="" draggable="false"><svg class="mk-svg" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="mk-load">Đang tải ảnh…</div><div class="mk-msg" hidden role="alert"></div></div>' +
        '<footer class="mk-bar"><div class="mk-tools">' + TOOLS.map(function (t) { return '<button class="mk-tool" data-tool="' + t[0] + '" aria-label="' + t[1] + '">' + IC[t[0]] + '<span>' + t[1] + '</span></button>'; }).join('') + '</div>' +
        '<div class="mk-row"><div class="mk-colors" role="radiogroup" aria-label="Màu nét">' + COLORS.map(function (c) { return '<button class="mk-dot" data-color="' + c + '" style="background:' + c + '" role="radio" aria-label="Màu ' + c + '"></button>'; }).join('') + '</div>' +
        '<div class="mk-acts"><button class="mk-act danger" data-a="del" disabled aria-label="Xoá nét đang chọn">' + IC.trash + '<span>Xoá nét</span></button><button class="mk-act" data-a="clear" disabled aria-label="Xoá tất cả">' + IC.clear + '<span>Xoá hết</span></button></div></div>' +
        '<div class="mk-hint"></div></footer>';
      document.body.appendChild(root);
      var q = function (s) { return root.querySelector(s); }, frame = q('.mk-frame'), img = q('img'), svg = q('.mk-svg'), stage = q('.mk-stage'), msg = q('.mk-msg');
      q('.mk-title').textContent = opt.title || 'Đánh dấu ảnh';
      var prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';

      function dirty() { return JSON.stringify(items) !== base; }
      function flash(t) { msg.textContent = t; msg.hidden = !t; }
      function refresh() {
        root.dataset.tool = tool; q('[data-a=undo]').disabled = !undo.length || saving; q('[data-a=save]').disabled = !dirty() || saving; q('[data-a=save]').textContent = saving ? 'Đang lưu…' : 'Lưu';
        q('[data-a=del]').disabled = !sel; q('[data-a=clear]').disabled = !items.length;
        root.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === tool); });
        root.querySelectorAll('[data-color]').forEach(function (b) { b.classList.toggle('on', b.dataset.color === color); b.setAttribute('aria-checked', String(b.dataset.color === color)); });
        q('.mk-hint').textContent = HINTS[tool] || '';
      }
      function selectionSVG() {
        var it = items.find(function (i) { return i.id === sel; }); if (!it || tool !== 'select') return '';
        var X = function (v) { return v * W; }, Y = function (v) { return v * H; }, dash = 'fill="none" stroke="#a7e0e6" stroke-width="3" stroke-dasharray="9 7" pointer-events="none"', hd = function (n, x, y) { return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="15" fill="#fff" stroke="#2a8c99" stroke-width="5" data-h="' + n + '" style="cursor:pointer"/>'; };
        if (it.t === 'a') return hd(1, X(it.x1), Y(it.y1)) + hd(2, X(it.x2), Y(it.y2));
        if (it.t === 'o' || it.t === 'r') { var lx = Math.min(it.x1, it.x2), rx = Math.max(it.x1, it.x2), ty = Math.min(it.y1, it.y2), by = Math.max(it.y1, it.y2); return '<rect x="' + (X(lx) - 6) + '" y="' + (Y(ty) - 6) + '" width="' + (X(rx) - X(lx) + 12) + '" height="' + (Y(by) - Y(ty) + 12) + '" ' + dash + '/>' + hd(1, X(it.x1), Y(it.y1)) + hd(2, X(it.x2), Y(it.y2)); }
        if (it.t === 'n') return '<circle cx="' + X(it.x) + '" cy="' + Y(it.y) + '" r="36" ' + dash + '/>';
        if (it.t === 'x') return '<rect x="' + (X(it.x) - 8) + '" y="' + (Y(it.y) - 40) + '" width="' + (Math.max(40, it.s.length * 18) + 16) + '" height="56" rx="8" ' + dash + '/>';
        return '';
      }
      function paint() { svg.innerHTML = allSVG(draft ? items.concat([draft]) : items, H, true) + selectionSVG(); refresh(); }
      function layout() {
        if (!img.naturalWidth) return; var cw = stage.clientWidth - 16, ch = stage.clientHeight - 16, s = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
        frame.style.width = Math.max(40, img.naturalWidth * s) + 'px'; frame.style.height = Math.max(40, img.naturalHeight * s) + 'px';
      }
      function push() { undo.push(JSON.stringify(items)); if (undo.length > 60) undo.shift(); }
      function pt(e) { var r = svg.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; }
      function nextNum() { return items.reduce(function (m, i) { return i.t === 'n' ? Math.max(m, i.n) : m; }, 0) + 1; }
      function find(id) { return items.find(function (i) { return i.id === id; }); }
      function closeText() { if (textBox) { var b = textBox; textBox = null; b.onblur = null; b.remove(); } }
      function openText(p) {
        closeText(); var b = document.createElement('input'); b.className = 'mk-text'; b.maxLength = 120; b.placeholder = 'Gõ chú thích rồi Enter'; b.setAttribute('aria-label', 'Chú thích');
        var rect = frame.getBoundingClientRect(); b.style.left = clamp(p.x * rect.width, 0, Math.max(0, rect.width - 150)) + 'px'; b.style.top = clamp(p.y * rect.height - 20, 0, Math.max(0, rect.height - 42)) + 'px'; frame.appendChild(b); textBox = b;
        var done = function (ok) { var v = b.value.replace(/\s+/g, ' ').trim(); closeText(); if (ok && v && items.length < MAX_ITEMS) { push(); var it = { id: uid(), t: 'x', c: color, x: p.x, y: Math.min(0.98, p.y + 0.03), s: v.slice(0, 120) }; items.push(it); sel = it.id; paint(); } };
        b.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
        b.onblur = function () { done(true); }; setTimeout(function () { b.focus(); }, 0);
      }
      svg.addEventListener('pointerdown', function (e) {
        if (e.button > 0 || saving) return; if (textBox) { closeText(); }
        var p = pt(e), target = e.target, hId = target.getAttribute && target.getAttribute('data-h'), g = target.closest && target.closest('[data-id]');
        flash('');
        if (tool === 'select' || hId) {
          if (hId && sel) { var it = find(sel); if (it) { push(); drag = { mode: 'h', it: it, h: hId }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); return; } }
          if (g) { var it2 = find(g.getAttribute('data-id')); sel = it2 ? it2.id : ''; if (it2) { push(); drag = { mode: 'move', it: it2, start: p, orig: JSON.parse(JSON.stringify(it2)) }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} } paint(); e.preventDefault(); return; }
          sel = ''; paint(); return;
        }
        if (items.length >= MAX_ITEMS) { flash('Đã đủ ' + MAX_ITEMS + ' nét đánh dấu trên một ảnh.'); return; }
        sel = '';
        if (tool === 'n') { push(); items.push({ id: uid(), t: 'n', c: color, x: p.x, y: p.y, n: nextNum() }); paint(); e.preventDefault(); return; }
        if (tool === 'x') { e.preventDefault(); openText(p); return; }
        push(); draft = { id: 'draft', t: tool, c: color, x1: p.x, y1: p.y, x2: p.x, y2: p.y }; drag = { mode: 'draw' }; try { svg.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); paint();
      });
      svg.addEventListener('pointermove', function (e) {
        if (!drag) return; var p = pt(e);
        if (drag.mode === 'draw' && draft) { draft.x2 = p.x; draft.y2 = p.y; }
        else if (drag.mode === 'h') { var k = drag.h === '1' ? ['x1', 'y1'] : ['x2', 'y2']; drag.it[k[0]] = p.x; drag.it[k[1]] = p.y; }
        else if (drag.mode === 'move') {
          var dx = p.x - drag.start.x, dy = p.y - drag.start.y, o = drag.orig, it = drag.it;
          if (it.t === 'n' || it.t === 'x') { it.x = clamp(o.x + dx, 0, 1); it.y = clamp(o.y + dy, 0, 1); }
          else { var mx = Math.max(-Math.min(o.x1, o.x2), Math.min(1 - Math.max(o.x1, o.x2), dx)), my = Math.max(-Math.min(o.y1, o.y2), Math.min(1 - Math.max(o.y1, o.y2), dy)); it.x1 = o.x1 + mx; it.x2 = o.x2 + mx; it.y1 = o.y1 + my; it.y2 = o.y2 + my; }
        }
        paint();
      });
      function endDrag() {
        if (!drag) return;
        if (drag.mode === 'draw' && draft) { var tiny = Math.hypot((draft.x2 - draft.x1) * W, (draft.y2 - draft.y1) * H) < 18; if (tiny) undo.pop(); else { draft.id = uid(); items.push(draft); } draft = null; }
        else if (JSON.stringify(items) === undo[undo.length - 1]) undo.pop();   // không đổi gì thì không tính là một bước
        drag = null; paint();
      }
      svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);

      function remove() { if (!sel) return; push(); items = items.filter(function (i) { return i.id !== sel; }); sel = ''; paint(); }
      function doUndo() { if (!undo.length) return; closeText(); items = JSON.parse(undo.pop()); if (!find(sel)) sel = ''; paint(); }
      function finish(result) { if (closing) return; closing = true; clearTimeout(discardTimer); closeText(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', layout); document.documentElement.style.overflow = prevOverflow; root.remove(); resolve(result); }
      async function save() {
        if (saving || !dirty()) return; closeText(); saving = true; flash(''); refresh();
        var out = items.length ? { v: 1, items: JSON.parse(JSON.stringify(items)) } : null;
        try { if (opt.save) await opt.save(out); finish(out || { v: 1, items: [] }); }
        catch (err) { saving = false; flash((err && err.message) || 'Chưa lưu được. Kiểm tra mạng rồi thử lại.'); refresh(); }
      }
      function tryClose() {
        if (saving) return;
        if (!dirty()) { finish(null); return; }
        var b = q('[data-a=close]'); if (b.dataset.arm) { finish(null); return; }
        b.dataset.arm = '1'; flash('Bỏ các thay đổi chưa lưu? Bấm ✕ lần nữa để bỏ.'); clearTimeout(discardTimer); discardTimer = setTimeout(function () { delete b.dataset.arm; flash(''); }, 3500);
      }
      function onKey(e) {
        if (textBox) return; var k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); tryClose(); }
        else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); doUndo(); }
        else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); }
        else if ((k === 'Delete' || k === 'Backspace') && sel) { e.preventDefault(); e.stopPropagation(); remove(); }
      }
      root.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.tool) { tool = b.dataset.tool; if (tool !== 'select') sel = ''; paint(); }
        else if (b.dataset.color) { color = b.dataset.color; var it = find(sel); if (it && tool === 'select') { push(); it.c = color; } paint(); }
        else if (b.dataset.a === 'close') tryClose();
        else if (b.dataset.a === 'undo') doUndo();
        else if (b.dataset.a === 'save') save();
        else if (b.dataset.a === 'del') remove();
        else if (b.dataset.a === 'clear') { if (!items.length) return; if (b.dataset.arm) { delete b.dataset.arm; push(); items = []; sel = ''; paint(); flash(''); } else { b.dataset.arm = '1'; flash('Xoá tất cả nét đánh dấu? Bấm "Xoá hết" lần nữa để xác nhận.'); setTimeout(function () { delete b.dataset.arm; flash(''); }, 3500); } }
      });
      document.addEventListener('keydown', onKey, true); window.addEventListener('resize', layout);
      img.onload = function () { aspect = img.naturalHeight / img.naturalWidth; H = W * aspect; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H.toFixed(2)); svg.setAttribute('preserveAspectRatio', 'none'); frame.hidden = false; q('.mk-load').hidden = true; layout(); paint(); };
      img.onerror = function () { q('.mk-load').textContent = 'Chưa tải được ảnh. Đóng rồi thử lại.'; };
      img.src = opt.url; refresh(); setTimeout(function () { var b = q('[data-tool="a"]'); if (b) b.focus({ preventScroll: true }); }, 30);
    });
  }

  window.TascoMarkup = { sanitize: sanitize, count: count, mount: mount, edit: edit, flatten: flatten, colors: COLORS };
})();

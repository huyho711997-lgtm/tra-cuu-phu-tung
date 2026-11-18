// Lịch trực TASCO DLK — đồng bộ 2 chiều với Google Sheet.
// Google Sheet là bản gốc: app đọc (pull) vào bảng tasco_duty_shifts, sửa trong app thì ghi thẳng vào đúng ô trên Sheet.
// Dùng chung kết nối Google OAuth của tasco-drive (bảng tasco_drive_config) — cần scope spreadsheets.
//  POST action=get           {month:'YYYY-MM', force?}  mọi tài khoản đang hoạt động: lịch tháng, hôm nay, ca của tôi, yêu cầu đổi ca.
//  POST action=config        (admin) {url}               gắn Google Sheet (link có #gid=… để chọn đúng tab).
//  POST action=update        (admin) {date, scene, detail} sửa ca, ghi Sheet.
//  POST action=swap-request  {date, role, toName, backDate?, reason}
//  POST action=swap-cancel   {id}                        người gửi huỷ yêu cầu đang chờ.
//  POST action=swap-decide   (admin) {id, approve, note}  duyệt -> ghi Sheet.
//  POST action=map           (admin) {userId, sheetName|null} gán tài khoản với tên trên Sheet.
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const STALE_MS = 90 * 1000;
const ROLES = { scene: 'Hiện trường', detail: 'Giám định chi tiết' };
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));

class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, ...extra }); }
}

/* ---------- Tiện ích thuần (được kiểm thử riêng) ---------- */
export const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
export const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
export function colLetter(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
export function parseSheetUrl(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,120})/) || String(url || '').match(/^([A-Za-z0-9_-]{30,120})$/);
  if (!m) return null;
  const g = String(url).match(/[#&?]gid=(\d{1,12})/);
  return { id: m[1], gid: g ? Number(g[1]) : null };
}
/* Ngày dạng 17/10/2026, 17-10-2026, 2026-10-17 hoặc số serial của Sheets -> 'YYYY-MM-DD'. */
export function parseDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  let y, mo, d;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(iso + 'T00:00:00Z');
  return t.getUTCDate() === d ? iso : null;
}
/* Tìm dòng tiêu đề + vị trí cột theo tên (không phụ thuộc thứ tự cột). */
export function parseSheet(rows) {
  rows = Array.isArray(rows) ? rows : [];
  let header = -1, cols = null;
  for (let r = 0; r < Math.min(rows.length, 15) && header < 0; r++) {
    const cells = (rows[r] || []).map(fold);
    const date = cells.findIndex(c => /^ngay\b/.test(c));
    const scene = cells.findIndex(c => c.includes('hien truong'));
    const detail = cells.findIndex(c => c.includes('chi tiet') || (c.includes('giam dinh') && !c.includes('hien truong')));
    if (date >= 0 && scene >= 0 && detail >= 0) {
      header = r;
      cols = { date, scene, detail, weekday: cells.findIndex(c => /^thu\b/.test(c)), dayType: cells.findIndex(c => c.includes('loai')), period: cells.findIndex(c => c.includes('ca truc')) };
    }
  }
  if (header < 0) throw new HttpError(422, 'SHEET_FORMAT', 'Không tìm thấy dòng tiêu đề có các cột “Ngày”, “Hiện trường”, “Giám định chi tiết” trên Sheet.');
  const shifts = [], seen = new Set();
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const date = parseDate(row[cols.date]);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    const get = i => (i >= 0 ? cleanName(row[i]) : '');
    shifts.push({ duty_date: date, weekday: get(cols.weekday) || null, day_type: get(cols.dayType) || null, period: get(cols.period) || null, scene: get(cols.scene) || null, detail: get(cols.detail) || null, sheet_row: r + 1 });
  }
  return { header: header + 1, cols, shifts };
}
export function peopleOf(shifts) {
  const map = new Map();
  for (const s of shifts) for (const n of [s.scene, s.detail]) if (n && !map.has(fold(n))) map.set(fold(n), n);
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'vi'));
}
export function vnToday(now = Date.now()) { return new Date(now + 7 * 3600e3).toISOString().slice(0, 10); }
/* Ca trực chạy 08:00 hôm nay -> 08:00 hôm sau: trước 8 giờ sáng vẫn là ca của ngày hôm trước. */
export function currentDutyDate(now = Date.now()) { return new Date(now + 7 * 3600e3 - 8 * 3600e3).toISOString().slice(0, 10); }

export function createHandler({ createClient, env, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  let tokenCache = null;
  return async req => {
    const origin = req.headers.get('origin');
    const allowed = (env('ALLOWED_ORIGINS') || 'https://huyho711997-lgtm.github.io,https://tra-cuu-phu-tung-pro.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', ...(origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ POST.');
      if (origin && !allowed.includes(origin)) throw new HttpError(403, 'ORIGIN_DENIED', 'Nguồn truy cập không được hỗ trợ.');
      const supaUrl = env('SUPABASE_URL'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
      if (!supaUrl || !serviceKey) throw new HttpError(503, 'NOT_CONFIGURED', 'Backend chưa được cấu hình.');
      const db = createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập lại.');
      if (Number(req.headers.get('content-length') || 0) > 16 * 1024) throw new HttpError(413, 'BODY_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
      const { data: auth, error: authError } = await db.auth.getUser(token);
      if (authError || !uuid(auth?.user?.id)) throw new HttpError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
      const actor = auth.user.id;
      const { data: profile, error: pErr } = await db.from('user_profiles').select('role,status,full_name,email').eq('id', actor).maybeSingle();
      if (pErr || profile?.status !== 'active') throw new HttpError(403, 'ACCESS_DENIED', 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.');
      const isAdmin = profile.role === 'admin';
      const actorName = cleanName(profile.full_name) || String(profile.email || '').split('@')[0];
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') throw new HttpError(400, 'INVALID_INPUT', 'Dữ liệu gửi lên không hợp lệ.');
      const action = String(body.action || '');
      const needAdmin = () => { if (!isAdmin) throw new HttpError(403, 'ADMIN_ONLY', 'Chỉ quản trị viên được thực hiện thao tác này.'); };
      const dbCheck = (res, what) => { if (res.error) throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'Không ' + what + ' được dữ liệu lịch trực. Hãy thử lại.'); return res.data; };

      /* ---------- Google ---------- */
      const google = async (url, init = {}, label = 'Google') => {
        try { return await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), ...init }); }
        catch (_) { throw new HttpError(504, 'GOOGLE_UNAVAILABLE', 'Không kết nối được Google (' + label + '). Hãy thử lại.'); }
      };
      const accessToken = async () => {
        const cfg = dbCheck(await db.from('tasco_drive_config').select('client_id,client_secret,refresh_token,account_email').eq('id', 1).maybeSingle(), 'đọc');
        if (!cfg?.refresh_token || !cfg.client_id || !cfg.client_secret) throw new HttpError(409, 'GOOGLE_NOT_CONNECTED', 'Chưa kết nối tài khoản Google. Vào Tài khoản → Google Drive để kết nối.');
        if (tokenCache && tokenCache.key === cfg.refresh_token && tokenCache.exp > now() + 60000) return tokenCache;
        const res = await google('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, grant_type: 'refresh_token', refresh_token: cfg.refresh_token }) }, 'token');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.access_token) {
          if (data.error === 'invalid_grant') throw new HttpError(409, 'GOOGLE_RECONNECT', 'Kết nối Google đã hết hiệu lực. Vào Tài khoản → Google Drive → Kết nối lại.');
          throw new HttpError(502, 'GOOGLE_ERROR', 'Google từ chối cấp quyền truy cập.');
        }
        const scope = String(data.scope || '');
        if (scope && !scope.includes('/auth/spreadsheets')) throw new HttpError(409, 'SHEETS_SCOPE', 'Kết nối Google chưa có quyền Google Sheets. Vào Tài khoản → Google Drive → Kết nối lại để cấp thêm quyền.');
        tokenCache = { key: cfg.refresh_token, token: data.access_token, email: cfg.account_email || '', exp: now() + (Number(data.expires_in) || 3000) * 1000 };
        return tokenCache;
      };
      const sheetsError = async (res, what) => {
        const text = await res.text().catch(() => '');
        let msg = ''; try { msg = JSON.parse(text)?.error?.message || ''; } catch (_) {}
        if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(text)) return new HttpError(502, 'SHEETS_API_DISABLED', 'Google Sheets API chưa được bật trong Google Cloud project.');
        if (res.status === 403 && /insufficient|scope/i.test(text)) return new HttpError(409, 'SHEETS_SCOPE', 'Kết nối Google chưa có quyền Google Sheets. Vào Tài khoản → Google Drive → Kết nối lại.');
        if (res.status === 403) return new HttpError(403, 'SHEET_FORBIDDEN', 'Tài khoản Google ' + (tokenCache?.email || 'đã kết nối') + ' chưa có quyền ' + what + ' Sheet này. Chia sẻ quyền Chỉnh sửa cho tài khoản đó.');
        if (res.status === 404) return new HttpError(404, 'SHEET_NOT_FOUND', 'Không tìm thấy Google Sheet. Kiểm tra lại link.');
        if (res.status === 401) { tokenCache = null; return new HttpError(409, 'GOOGLE_RECONNECT', 'Kết nối Google đã hết hiệu lực. Kết nối lại.'); }
        return new HttpError(502, 'GOOGLE_ERROR', 'Google Sheets báo lỗi (mã ' + res.status + (msg ? ': ' + msg.slice(0, 120) : '') + ').');
      };
      const quoteTab = t => "'" + String(t).replace(/'/g, "''") + "'";
      const readValues = async (cfg, range) => {
        const { token: at } = await accessToken();
        const res = await google(SHEETS + encodeURIComponent(cfg.spreadsheet_id) + '/values/' + encodeURIComponent(range) + '?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS', { headers: { Authorization: 'Bearer ' + at } }, 'đọc Sheet');
        if (!res.ok) throw await sheetsError(res, 'đọc');
        return (await res.json().catch(() => ({}))).values || [];
      };
      const writeCells = async (cfg, cells) => {
        const { token: at } = await accessToken();
        const res = await google(SHEETS + encodeURIComponent(cfg.spreadsheet_id) + '/values:batchUpdate', { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
          body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: cells.map(c => ({ range: quoteTab(cfg.sheet_title) + '!' + c.a1, values: [[c.value]] })) }) }, 'ghi Sheet');
        if (!res.ok) throw await sheetsError(res, 'sửa');
        await res.arrayBuffer?.().catch(() => null);
      };

      /* ---------- Đồng bộ ---------- */
      const readCfg = async () => dbCheck(await db.from('tasco_duty_config').select('*').eq('id', 1).maybeSingle(), 'đọc');
      let parsed = null;
      const pull = async cfg => {
        const rows = await readValues(cfg, quoteTab(cfg.sheet_title));
        parsed = parseSheet(rows);
        if (!parsed.shifts.length) throw new HttpError(422, 'SHEET_EMPTY', 'Sheet lịch trực không có dòng ngày nào hợp lệ (cột Ngày dạng 17/10/2026).');
        const stamp = new Date(now()).toISOString();
        const list = parsed.shifts.map(s => ({ ...s, synced_at: stamp }));
        for (let i = 0; i < list.length; i += 500) dbCheck(await db.from('tasco_duty_shifts').upsert(list.slice(i, i + 500), { onConflict: 'duty_date' }), 'lưu');
        // Dòng đã bị xoá khỏi Sheet -> xoá khỏi app (Sheet là bản gốc).
        dbCheck(await db.from('tasco_duty_shifts').delete().lt('synced_at', stamp), 'lưu');
        dbCheck(await db.from('tasco_duty_config').update({ last_sync_at: stamp, last_sync_error: null }).eq('id', 1), 'lưu');
        return parsed;
      };
      const pullSafe = async (cfg, force) => {
        if (!cfg?.spreadsheet_id) return null;
        const fresh = cfg.last_sync_at && now() - new Date(cfg.last_sync_at).getTime() < STALE_MS && !cfg.last_sync_error;
        if (fresh && !force) return null;
        try { await pull(cfg); return null; }
        catch (e) {
          const msg = e instanceof HttpError ? e.message : 'Chưa đồng bộ được với Google Sheet.';
          await db.from('tasco_duty_config').update({ last_sync_error: msg, last_sync_at: new Date(now()).toISOString() }).eq('id', 1);
          if (force) throw e;
          return msg;
        }
      };
      const shiftRow = async date => dbCheck(await db.from('tasco_duty_shifts').select('*').eq('duty_date', date).maybeSingle(), 'đọc');
      /* Trước khi ghi: đọc lại đúng dòng trên Sheet để chắc dòng chưa bị chèn/xoá lệch. */
      const verifyRow = async (cfg, date) => {
        let row = await shiftRow(date);
        if (!row) throw new HttpError(404, 'SHIFT_NOT_FOUND', 'Không có ngày này trên Sheet lịch trực.');
        if (!parsed) { await pull(cfg); row = await shiftRow(date); if (!row) throw new HttpError(404, 'SHIFT_NOT_FOUND', 'Ngày này không còn trên Sheet.'); }
        return { row, cols: parsed.cols };
      };
      const myName = async (people) => {
        const m = dbCheck(await db.from('tasco_duty_members').select('sheet_name').eq('user_id', actor).maybeSingle(), 'đọc');
        if (m?.sheet_name) return m.sheet_name;
        const f = fold(profile.full_name);
        if (!f) return null;
        const hit = people.filter(p => fold(p) === f);
        return hit.length === 1 ? hit[0] : null;
      };

      if (action === 'config') {
        needAdmin();
        const ref = parseSheetUrl(body.url);
        if (!ref) throw new HttpError(400, 'INVALID_INPUT', 'Link Google Sheet không đúng dạng (https://docs.google.com/spreadsheets/d/…).');
        const { token: at } = await accessToken();
        const res = await google(SHEETS + encodeURIComponent(ref.id) + '?fields=' + encodeURIComponent('properties.title,sheets.properties(sheetId,title)'), { headers: { Authorization: 'Bearer ' + at } }, 'mở Sheet');
        if (!res.ok) throw await sheetsError(res, 'đọc');
        const meta = await res.json().catch(() => ({}));
        const tabs = (meta.sheets || []).map(s => s.properties).filter(Boolean);
        if (!tabs.length) throw new HttpError(422, 'SHEET_FORMAT', 'Sheet không có trang tính nào.');
        let tab = ref.gid !== null ? tabs.find(t => Number(t.sheetId) === ref.gid) : null;
        let probe = null;
        const tryTab = async t => { try { return parseSheet(await readValues({ spreadsheet_id: ref.id }, quoteTab(t.title) + '!A1:Z15')); } catch (e) { if (e.code === 'SHEET_FORMAT') return null; throw e; } };
        if (tab) probe = await tryTab(tab);
        else for (const t of tabs) { probe = await tryTab(t); if (probe) { tab = t; break; } }
        if (!tab) throw new HttpError(422, 'SHEET_FORMAT', 'Không tìm thấy trang tính có cột “Ngày”, “Hiện trường”, “Giám định chi tiết”. Mở đúng tab rồi chép link (có #gid=…).');
        if (!probe) throw new HttpError(422, 'SHEET_FORMAT', 'Tab “' + tab.title + '” không có cột “Ngày”, “Hiện trường”, “Giám định chi tiết”.');
        const cfg = { id: 1, spreadsheet_id: ref.id, sheet_gid: Number(tab.sheetId), sheet_title: tab.title, last_sync_at: null, last_sync_error: null, updated_by: actor, updated_at: new Date(now()).toISOString() };
        dbCheck(await db.from('tasco_duty_config').upsert(cfg, { onConflict: 'id' }), 'lưu');
        const p = await pull(cfg);
        return reply({ ok: true, title: meta.properties?.title || '', tab: tab.title, rows: p.shifts.length });
      }

      const cfg = await readCfg();
      if (!cfg?.spreadsheet_id) {
        if (action === 'get') return reply({ configured: false, admin: isAdmin });
        throw new HttpError(409, 'NOT_CONFIGURED', 'Quản trị viên chưa gắn Google Sheet lịch trực.');
      }

      if (action === 'get') {
        const month = String(body.month || vnToday(now()).slice(0, 7));
        if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'INVALID_INPUT', 'Tháng không hợp lệ.');
        const syncError = await pullSafe(cfg, Boolean(body.force) && isAdmin);   // admin bấm “Đồng bộ ngay” thì báo lỗi thật
        const [y, m] = month.split('-').map(Number);
        const from = new Date(Date.UTC(y, m - 1, 1) - 7 * 864e5).toISOString().slice(0, 10);
        const to = new Date(Date.UTC(y, m, 1) + 7 * 864e5).toISOString().slice(0, 10);
        const shifts = dbCheck(await db.from('tasco_duty_shifts').select('duty_date,weekday,day_type,period,scene,detail').gte('duty_date', from).lt('duty_date', to).order('duty_date'), 'đọc');
        const all = dbCheck(await db.from('tasco_duty_shifts').select('scene,detail').gte('duty_date', new Date(now() - 120 * 864e5).toISOString().slice(0, 10)), 'đọc');
        const people = peopleOf(all);
        const me = await myName(people);
        const todayKey = currentDutyDate(now());
        const today = await shiftRow(todayKey);
        // 60 ngày tới (mọi người): để chọn ca đổi lại và hiện "Ca của tôi".
        const ahead = dbCheck(await db.from('tasco_duty_shifts').select('duty_date,weekday,day_type,scene,detail').gte('duty_date', todayKey).order('duty_date').limit(60), 'đọc');
        const upcoming = me ? ahead.filter(s => fold(s.scene) === fold(me) || fold(s.detail) === fold(me)).slice(0, 10) : [];
        let swapsQ = db.from('tasco_duty_swaps').select('*').order('created_at', { ascending: false }).limit(40);
        if (!isAdmin) swapsQ = swapsQ.eq('requested_by', actor);
        const swaps = dbCheck(await swapsQ, 'đọc');
        let members;
        if (isAdmin) {
          const profiles = dbCheck(await db.from('user_profiles').select('id,full_name,email,status').eq('status', 'active').order('full_name'), 'đọc');
          const maps = dbCheck(await db.from('tasco_duty_members').select('user_id,sheet_name'), 'đọc');
          const byId = new Map(maps.map(x => [x.user_id, x.sheet_name]));
          members = profiles.map(pr => {
            const auto = people.filter(n => fold(n) === fold(pr.full_name));
            return { id: pr.id, name: cleanName(pr.full_name) || pr.email, email: pr.email, sheetName: byId.get(pr.id) || (auto.length === 1 ? auto[0] : null), manual: byId.has(pr.id) };
          });
        }
        const fresh = await readCfg();
        return reply({ configured: true, admin: isAdmin, month, today: today ? { ...today, sheet_row: undefined, synced_at: undefined } : null, todayKey, shifts, people, me, upcoming, ahead, swaps,
          sync: { at: fresh?.last_sync_at || null, error: fresh?.last_sync_error || syncError || null, tab: cfg.sheet_title },
          ...(isAdmin ? { sheetUrl: 'https://docs.google.com/spreadsheets/d/' + cfg.spreadsheet_id + '/edit#gid=' + (cfg.sheet_gid ?? 0), members } : {}) });
      }

      if (action === 'update') {
        needAdmin();
        const date = String(body.date || '');
        if (!isoDate(date)) throw new HttpError(400, 'INVALID_INPUT', 'Ngày không hợp lệ.');
        const scene = cleanName(body.scene), detail = cleanName(body.detail);
        await pull(cfg);
        const { row, cols } = await verifyRow(cfg, date);
        const cells = [];
        if (scene !== (row.scene || '')) cells.push({ a1: colLetter(cols.scene) + row.sheet_row, value: scene });
        if (detail !== (row.detail || '')) cells.push({ a1: colLetter(cols.detail) + row.sheet_row, value: detail });
        if (cells.length) await writeCells(cfg, cells);
        dbCheck(await db.from('tasco_duty_shifts').update({ scene: scene || null, detail: detail || null }).eq('duty_date', date), 'lưu');
        return reply({ ok: true, changed: cells.length });
      }

      if (action === 'swap-request') {
        const date = String(body.date || ''), role = String(body.role || ''), toName = cleanName(body.toName), reason = cleanName(String(body.reason || '')).slice(0, 300);
        const backDate = body.backDate ? String(body.backDate) : null;
        if (!isoDate(date) || !ROLES[role] || !toName) throw new HttpError(400, 'INVALID_INPUT', 'Thiếu ngày, vai trò hoặc người nhận ca.');
        if (backDate && !isoDate(backDate)) throw new HttpError(400, 'INVALID_INPUT', 'Ngày trả ca không hợp lệ.');
        if (date < currentDutyDate(now())) throw new HttpError(400, 'INVALID_INPUT', 'Không xin đổi ca đã qua.');
        await pullSafe(cfg, false);
        const row = await shiftRow(date);
        if (!row) throw new HttpError(404, 'SHIFT_NOT_FOUND', 'Không có ngày này trên lịch trực.');
        const all = dbCheck(await db.from('tasco_duty_shifts').select('scene,detail').gte('duty_date', new Date(now() - 120 * 864e5).toISOString().slice(0, 10)), 'đọc');
        const people = peopleOf(all);
        const target = people.find(p => fold(p) === fold(toName));
        if (!target) throw new HttpError(400, 'INVALID_INPUT', 'Người nhận ca không có trong lịch trực.');
        const fromName = row[role];
        if (!fromName) throw new HttpError(400, 'INVALID_INPUT', 'Ngày này chưa có người trực ' + ROLES[role] + '.');
        const me = await myName(people);
        if (!isAdmin && (!me || fold(me) !== fold(fromName))) throw new HttpError(403, 'NOT_YOUR_SHIFT', 'Bạn chỉ xin đổi được ca của chính mình.');
        if (fold(target) === fold(fromName)) throw new HttpError(400, 'INVALID_INPUT', 'Hãy chọn người khác.');
        let backRole = null;
        if (backDate) {
          if (backDate === date) throw new HttpError(400, 'INVALID_INPUT', 'Ngày trả ca phải khác ngày đổi.');
          const back = await shiftRow(backDate);
          backRole = back && fold(back.scene) === fold(target) ? 'scene' : back && fold(back.detail) === fold(target) ? 'detail' : null;
          if (!backRole) throw new HttpError(400, 'INVALID_INPUT', target + ' không có ca trực ngày trả ca đã chọn.');
        }
        const dup = dbCheck(await db.from('tasco_duty_swaps').select('id').eq('duty_date', date).eq('role', role).eq('status', 'pending').limit(1), 'đọc');
        if (dup.length) throw new HttpError(409, 'DUPLICATE', 'Ca này đã có yêu cầu đổi đang chờ duyệt.');
        const rec = { duty_date: date, role, from_name: fromName, to_name: target, back_date: backDate, back_role: backRole, reason: reason || null, requested_by: actor, requester_name: actorName };
        const saved = dbCheck(await db.from('tasco_duty_swaps').insert(rec).select('*').single(), 'lưu');
        return reply({ ok: true, swap: saved });
      }

      if (action === 'swap-cancel') {
        if (!uuid(body.id)) throw new HttpError(400, 'INVALID_INPUT', 'Yêu cầu không hợp lệ.');
        const sw = dbCheck(await db.from('tasco_duty_swaps').select('*').eq('id', body.id).maybeSingle(), 'đọc');
        if (!sw || (sw.requested_by !== actor && !isAdmin)) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy yêu cầu.');
        if (sw.status !== 'pending') throw new HttpError(409, 'ALREADY_DECIDED', 'Yêu cầu đã được xử lý.');
        dbCheck(await db.from('tasco_duty_swaps').update({ status: 'cancelled', decided_at: new Date(now()).toISOString(), decided_by: actor, decider_name: actorName }).eq('id', sw.id).eq('status', 'pending'), 'lưu');
        return reply({ ok: true });
      }

      if (action === 'swap-decide') {
        needAdmin();
        if (!uuid(body.id)) throw new HttpError(400, 'INVALID_INPUT', 'Yêu cầu không hợp lệ.');
        const sw = dbCheck(await db.from('tasco_duty_swaps').select('*').eq('id', body.id).maybeSingle(), 'đọc');
        if (!sw) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy yêu cầu.');
        if (sw.status !== 'pending') throw new HttpError(409, 'ALREADY_DECIDED', 'Yêu cầu đã được xử lý.');
        const note = cleanName(String(body.note || '')).slice(0, 300) || null;
        if (body.approve) {
          await pull(cfg);
          const { row, cols } = await verifyRow(cfg, sw.duty_date);
          if (fold(row[sw.role]) !== fold(sw.from_name)) throw new HttpError(409, 'SHEET_CHANGED', 'Ca ngày này trên Sheet đã đổi (hiện là ' + (row[sw.role] || 'trống') + '). Hãy từ chối hoặc sửa tay.');
          const cells = [{ a1: colLetter(cols[sw.role]) + row.sheet_row, value: sw.to_name }];
          let back = null;
          if (sw.back_date) {
            back = (await verifyRow(cfg, sw.back_date)).row;
            if (fold(back[sw.back_role]) !== fold(sw.to_name)) throw new HttpError(409, 'SHEET_CHANGED', 'Ca trả ngày ' + sw.back_date + ' trên Sheet đã đổi. Hãy từ chối hoặc sửa tay.');
            cells.push({ a1: colLetter(cols[sw.back_role]) + back.sheet_row, value: sw.from_name });
          }
          await writeCells(cfg, cells);
          dbCheck(await db.from('tasco_duty_shifts').update({ [sw.role]: sw.to_name }).eq('duty_date', sw.duty_date), 'lưu');
          if (back) dbCheck(await db.from('tasco_duty_shifts').update({ [sw.back_role]: sw.from_name }).eq('duty_date', sw.back_date), 'lưu');
        }
        dbCheck(await db.from('tasco_duty_swaps').update({ status: body.approve ? 'approved' : 'rejected', decided_by: actor, decider_name: actorName, decided_at: new Date(now()).toISOString(), note }).eq('id', sw.id).eq('status', 'pending'), 'lưu');
        return reply({ ok: true });
      }

      if (action === 'map') {
        needAdmin();
        if (!uuid(body.userId)) throw new HttpError(400, 'INVALID_INPUT', 'Tài khoản không hợp lệ.');
        const name = cleanName(body.sheetName);
        if (!name) { dbCheck(await db.from('tasco_duty_members').delete().eq('user_id', body.userId), 'lưu'); return reply({ ok: true }); }
        dbCheck(await db.from('tasco_duty_members').upsert({ user_id: body.userId, sheet_name: name, updated_by: actor, updated_at: new Date(now()).toISOString() }, { onConflict: 'user_id' }), 'lưu');
        return reply({ ok: true });
      }

      throw new HttpError(400, 'INVALID_INPUT', 'Yêu cầu không hợp lệ.');
    } catch (error) {
      if (error instanceof HttpError) return reply({ error: error.message, code: error.code }, error.status);
      return reply({ error: 'Backend chưa xử lý được yêu cầu. Hãy thử lại sau.', code: 'INTERNAL_ERROR' }, 500);
    }
  };
}

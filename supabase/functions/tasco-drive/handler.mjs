// Đẩy video/tệp nặng lên Google Drive của quản trị viên (OAuth, scope drive.file) cho app TASCO DLK.
//  GET  ?code&state       Google chuyển hướng về sau khi admin đồng ý -> đổi mã lấy refresh token, tạo thư mục, quay lại app.
//  POST action=status       (mọi tài khoản đang hoạt động) đã kết nối chưa, thư mục đích.
//  POST action=save-config  (admin) lưu Client ID + Client secret của OAuth client.
//  POST action=auth-url     (admin) tạo đường dẫn đăng nhập Google (state dùng 1 lần, 10 phút).
//  POST action=session      (mọi tài khoản đang hoạt động) mở phiên upload resumable -> trình duyệt đẩy từng khúc thẳng lên Google.
//  POST action=disconnect   (admin) xoá kết nối.
// Client secret + refresh token chỉ nằm trong bảng tasco_drive_config (RLS khóa, chỉ service role đọc), không bao giờ gửi xuống app.
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Tasco DLK - Video';
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_SIZE = 4 * 1024 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9._~-]{20,300}\.apps\.googleusercontent\.com$/;
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, ...extra }); }
}

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const randomState = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const safeEqual = (a, b) => {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
function jwtEmail(idToken) {
  try {
    const part = String(idToken || '').split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const email = JSON.parse(json)?.email;
    return typeof email === 'string' ? email.slice(0, 200) : '';
  } catch (_) { return ''; }
}
// Tên tệp an toàn: bỏ ký tự điều khiển và dấu / \, giới hạn độ dài.
export const cleanName = (name, fallback = 'video.mp4') => {
  const n = String(name || '').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  return n || fallback;
};

export function createHandler({ createClient, env, fetchImpl = globalThis.fetch }) {
  let tokenCache = null; // { token, exp } access token trong bộ nhớ instance
  return async req => {
    const origin = req.headers.get('origin');
    const allowed = (env('ALLOWED_ORIGINS') || 'https://huyho711997-lgtm.github.io,https://tra-cuu-phu-tung-pro.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...(origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    const appUrl = (env('APP_URL') || 'https://huyho711997-lgtm.github.io/tra-cuu-phu-tung/mobile.html').trim();
    const back = result => new Response(null, { status: 302, headers: { Location: appUrl + (appUrl.includes('?') ? '&' : '?') + 'drive=' + encodeURIComponent(result), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const reqUrl = new URL(req.url);
    const supaUrl = env('SUPABASE_URL'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    // Đường dẫn công khai mà Google gọi lại: phải khớp đúng "Authorized redirect URI" admin đã khai trên Google Cloud.
    const redirectUri = supaUrl ? supaUrl.replace(/\/$/, '') + '/functions/v1/tasco-drive' : '';
    const service = supaUrl && serviceKey ? createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
    const readConfig = async () => {
      const { data, error } = await service.from('tasco_drive_config').select('*').eq('id', 1).maybeSingle();
      if (error) throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'Không đọc được cấu hình Drive. Hãy thử lại sau.');
      return data || null;
    };
    const writeConfig = async patch => {
      const { error } = await service.from('tasco_drive_config').upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'Không lưu được cấu hình Drive. Hãy thử lại sau.');
    };
    const google = async (url, init, label) => {
      try { return await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), ...init }); }
      catch (_) { throw new HttpError(504, 'GOOGLE_UNAVAILABLE', 'Không kết nối được Google (' + label + '). Hãy thử lại.'); }
    };
    const exchange = async (cfg, params) => {
      const res = await google('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, ...params }) }, 'token');
      const data = await res.json().catch(() => ({}));
      return { res, data };
    };
    const accessToken = async cfg => {
      if (tokenCache && tokenCache.key === cfg.refresh_token && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
      const { res, data } = await exchange(cfg, { grant_type: 'refresh_token', refresh_token: cfg.refresh_token });
      if (!res.ok || !data.access_token) {
        if (data.error === 'invalid_grant') { await writeConfig({ refresh_token: null, connected_at: null }); tokenCache = null; throw new HttpError(409, 'DRIVE_RECONNECT', 'Kết nối Google Drive đã hết hiệu lực. Quản trị viên hãy kết nối lại.'); }
        throw new HttpError(502, 'GOOGLE_ERROR', 'Google từ chối cấp quyền truy cập Drive.', { googleStatus: res.status });
      }
      tokenCache = { key: cfg.refresh_token, token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
      return data.access_token;
    };
    const createFolder = async token => {
      const res = await google('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) }, 'tạo thư mục');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) throw new HttpError(502, 'GOOGLE_ERROR', 'Không tạo được thư mục trên Drive (Google trả mã ' + res.status + '). Kiểm tra đã bật Google Drive API chưa.', { googleStatus: res.status });
      return String(data.id);
    };

    try {
      if (!service || !redirectUri) throw new HttpError(503, 'NOT_CONFIGURED', 'Backend chưa được cấu hình.');

      /* ---------- Google chuyển hướng về ---------- */
      if (req.method === 'GET') {
        const code = reqUrl.searchParams.get('code'), state = reqUrl.searchParams.get('state'), gerr = reqUrl.searchParams.get('error');
        if (gerr) return back(gerr === 'access_denied' ? 'denied' : 'error');
        if (!code || !state) return back('error');
        const cfg = await readConfig();
        const fresh = cfg?.pending_state_at && Date.now() - new Date(cfg.pending_state_at).getTime() < STATE_TTL_MS;
        if (!cfg || !fresh || !safeEqual(cfg.pending_state, state) || !cfg.client_id || !cfg.client_secret) return back('expired');
        await writeConfig({ pending_state: null, pending_state_at: null }); // dùng 1 lần
        const { res, data } = await exchange(cfg, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
        if (!res.ok || !data.access_token) return back(data.error === 'invalid_client' ? 'client' : 'error');
        const refresh = data.refresh_token || cfg.refresh_token;
        if (!refresh) return back('norefresh');
        let folder = cfg.folder_id;
        // Thư mục cũ có thể đã bị xoá: kiểm tra, không còn thì tạo lại.
        if (folder) {
          const chk = await google('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folder) + '?fields=id,trashed', { headers: { Authorization: 'Bearer ' + data.access_token } }, 'kiểm tra thư mục');
          const info = chk.ok ? await chk.json().catch(() => ({})) : {};
          if (!chk.ok || info.trashed) folder = null; else await chk.arrayBuffer?.().catch(() => null);
        }
        if (!folder) folder = await createFolder(data.access_token);
        tokenCache = null;
        await writeConfig({ refresh_token: refresh, folder_id: folder, account_email: jwtEmail(data.id_token) || cfg.account_email || null, connected_at: new Date().toISOString() });
        return back('ok');
      }
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ POST.');
      if (origin && !allowed.includes(origin)) throw new HttpError(403, 'ORIGIN_DENIED', 'Nguồn truy cập không được hỗ trợ.');

      const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập lại.');
      if (Number(req.headers.get('content-length') || 0) > 16 * 1024) throw new HttpError(413, 'BODY_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
      const { data: auth, error: authError } = await service.auth.getUser(token);
      if (authError || !uuid(auth?.user?.id)) throw new HttpError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
      const actor = auth.user.id;
      const { data: profile, error: profileError } = await service.from('user_profiles').select('role,status').eq('id', actor).maybeSingle();
      if (profileError || profile?.status !== 'active') throw new HttpError(403, 'ACCESS_DENIED', 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.');
      const isAdmin = profile.role === 'admin';
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') throw new HttpError(400, 'INVALID_INPUT', 'Dữ liệu gửi lên không hợp lệ.');
      const action = String(body.action || '');
      const needAdmin = () => { if (!isAdmin) throw new HttpError(403, 'ADMIN_ONLY', 'Chỉ quản trị viên được thiết lập kết nối Google Drive.'); };
      const cfg = await readConfig();

      if (action === 'status') {
        const connected = Boolean(cfg?.refresh_token && cfg?.folder_id);
        return reply({ configured: Boolean(cfg?.client_id && cfg?.client_secret), connected, admin: isAdmin, redirectUri,
          ...(connected ? { folderUrl: 'https://drive.google.com/drive/folders/' + cfg.folder_id, email: isAdmin ? (cfg.account_email || '') : undefined } : {}),
          ...(isAdmin && cfg?.client_id ? { clientId: cfg.client_id } : {}) });
      }

      if (action === 'save-config') {
        needAdmin();
        const clientId = String(body.clientId || '').trim(), clientSecret = String(body.clientSecret || '').trim();
        if (!ID_RE.test(clientId)) throw new HttpError(400, 'INVALID_INPUT', 'Client ID không đúng dạng (…apps.googleusercontent.com).');
        if (clientSecret.length < 8 || clientSecret.length > 200 || /\s/.test(clientSecret)) throw new HttpError(400, 'INVALID_INPUT', 'Client secret không hợp lệ.');
        const same = cfg?.client_id === clientId;
        // Đổi client khác thì kết nối cũ không còn dùng được.
        await writeConfig({ client_id: clientId, client_secret: clientSecret, updated_by: actor, ...(same ? {} : { refresh_token: null, folder_id: null, account_email: null, connected_at: null }), pending_state: null, pending_state_at: null });
        tokenCache = null;
        return reply({ ok: true, redirectUri });
      }

      if (action === 'auth-url') {
        needAdmin();
        if (!cfg?.client_id || !cfg?.client_secret) throw new HttpError(409, 'NOT_CONFIGURED', 'Hãy nhập Client ID và Client secret trước.');
        const state = randomState();
        await writeConfig({ pending_state: state, pending_state_at: new Date().toISOString(), updated_by: actor });
        const q = new URLSearchParams({ client_id: cfg.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state });
        return reply({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + q });
      }

      if (action === 'disconnect') {
        needAdmin();
        if (cfg?.refresh_token) await google('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: cfg.refresh_token }) }, 'thu hồi').then(r => r.arrayBuffer?.()).catch(() => null);
        await writeConfig({ refresh_token: null, folder_id: null, account_email: null, connected_at: null, pending_state: null, pending_state_at: null });
        tokenCache = null;
        return reply({ ok: true });
      }

      if (action === 'session') {
        if (!cfg?.refresh_token || !cfg?.folder_id) throw new HttpError(409, 'DRIVE_NOT_CONNECTED', 'Quản trị viên chưa kết nối Google Drive.');
        const size = Number(body.size), mime = String(body.mime || '').split(';')[0].trim().toLowerCase();
        if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) throw new HttpError(400, 'INVALID_INPUT', 'Kích thước tệp không hợp lệ.');
        if (!/^(video|image)\/[a-z0-9.+-]{1,40}$/.test(mime)) throw new HttpError(400, 'INVALID_INPUT', 'Chỉ nhận video hoặc ảnh.');
        const name = cleanName(body.name, mime.startsWith('video/') ? 'video.mp4' : 'anh.jpg');
        const start = async (folderId) => {
          const at = await accessToken(cfg);
          const headers = { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) };
          // Origin của trình duyệt phải gắn vào lúc mở phiên thì Google mới cho phép trình duyệt PUT từng khúc (CORS).
          if (origin && allowed.includes(origin)) headers.Origin = origin;
          return google('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size', { method: 'POST', headers,
            body: JSON.stringify({ name, parents: [folderId], description: 'Tải lên từ app TASCO DLK bởi ' + String(auth.user.email || actor).slice(0, 120) }) }, 'mở phiên upload');
        };
        let res = await start(cfg.folder_id);
        if (res.status === 404) { // thư mục đích bị xoá -> tạo lại một lần
          await res.arrayBuffer().catch(() => null);
          const folder = await createFolder(await accessToken(cfg));
          await writeConfig({ folder_id: folder }); cfg.folder_id = folder;
          res = await start(folder);
        }
        if (res.status === 401) { tokenCache = null; await res.arrayBuffer().catch(() => null); throw new HttpError(409, 'DRIVE_RECONNECT', 'Kết nối Google Drive đã hết hiệu lực. Quản trị viên hãy kết nối lại.'); }
        const uploadUrl = res.headers.get('location');
        if (!res.ok || !uploadUrl) {
          const text = await res.text().catch(() => '');
          const quota = /storageQuotaExceeded|quota/i.test(text);
          throw new HttpError(quota ? 507 : 502, quota ? 'DRIVE_FULL' : 'GOOGLE_ERROR', quota ? 'Drive của quản trị viên đã đầy dung lượng.' : 'Google chưa mở được phiên tải lên (mã ' + res.status + ').', { googleStatus: res.status });
        }
        await res.arrayBuffer().catch(() => null);
        return reply({ uploadUrl, name, folderUrl: 'https://drive.google.com/drive/folders/' + cfg.folder_id });
      }

      throw new HttpError(400, 'INVALID_INPUT', 'Yêu cầu không hợp lệ.');
    } catch (error) {
      if (req.method === 'GET') return back(error instanceof HttpError && error.code === 'GOOGLE_UNAVAILABLE' ? 'network' : 'error');
      if (error instanceof HttpError) return reply({ error: error.message, code: error.code, ...(error.googleStatus ? { googleStatus: error.googleStatus } : {}) }, error.status);
      return reply({ error: 'Backend chưa xử lý được yêu cầu. Hãy thử lại sau.', code: 'INTERNAL_ERROR' }, 500);
    }
  };
}

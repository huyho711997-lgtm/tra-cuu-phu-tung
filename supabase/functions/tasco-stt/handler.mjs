// Chuyển giọng nói thành chữ (Groq Whisper) cho app TASCO DLK.
// Dùng lại kho key groq1/groq2/groq3 của kgpt-ai (Vault), đăng nhập + giới hạn tần suất như kgpt-ai. Không lưu âm thanh.
const MODEL = 'whisper-large-v3-turbo';
const MAX_AUDIO = 8 * 1024 * 1024;          // ghi âm đọc lệnh chỉ vài giây; chặn file lớn bất thường
const MIN_AUDIO = 800;
const MAX_BODY = MAX_AUDIO + 256 * 1024;
const LANGS = ['vi', 'en'];
const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'video/mp4': 'mp4', 'video/webm': 'webm' };
// Whisper hay "nghe ra" những câu này khi đoạn ghi im lặng/nhiễu (dữ liệu huấn luyện từ video có phụ đề).
const HALLUCINATION = /(đăng ký (kênh|ngay)|ghiền mì gõ|subscribe|để không bỏ lỡ|cảm ơn (các bạn|quý vị) đã (xem|theo dõi|lắng nghe)|amara\.org|hẹn gặp lại các bạn|thanks for watching|phụ đề)/i;
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, ...extra }); }
}

export function cleanTranscript(data) {
  const segs = Array.isArray(data?.segments) ? data.segments : [];
  let text;
  if (segs.length) {
    // Bỏ đoạn mà mô hình tự đánh giá là không có tiếng nói / độ tin cậy rất thấp.
    text = segs.filter(s => !((Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -0.8) || Number(s.compression_ratio) > 2.8))
      .map(s => String(s.text || '')).join(' ');
  } else text = String(data?.text || '');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || HALLUCINATION.test(text)) return '';
  // Lặp một cụm quá nhiều lần là dấu hiệu Whisper bị "kẹt".
  if (/(\b.{2,24}\b)(?:\s+\1){5,}/i.test(text)) return '';
  return text.slice(0, 1000);
}

export function createHandler({ createClient, env, fetchImpl = globalThis.fetch }) {
  return async req => {
    const origin = req.headers.get('origin');
    const allowed = (env('ALLOWED_ORIGINS') || 'https://huyho711997-lgtm.github.io,https://tra-cuu-phu-tung-pro.vercel.app').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    if (origin && !allowed.includes(origin)) return reply({ error: 'Nguồn truy cập không được hỗ trợ.', code: 'ORIGIN_DENIED' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply({ error: 'Chỉ hỗ trợ POST.', code: 'METHOD_NOT_ALLOWED' }, 405);
    try {
      const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập lại.');
      if (Number(req.headers.get('content-length') || 0) > MAX_BODY) throw new HttpError(413, 'BODY_TOO_LARGE', 'Đoạn ghi âm quá dài.');
      const url = env('SUPABASE_URL'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !serviceKey) throw new HttpError(503, 'NOT_CONFIGURED', 'Backend chưa được cấu hình.');
      const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: auth, error: authError } = await service.auth.getUser(token);
      if (authError || !uuid(auth?.user?.id)) throw new HttpError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
      const actor = auth.user.id;
      const { data: profile, error: profileError } = await service.from('user_profiles').select('role,status').eq('id', actor).maybeSingle();
      if (profileError || profile?.status !== 'active') throw new HttpError(403, 'ACCESS_DENIED', 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.');
      const type = req.headers.get('content-type') || '';
      if (!type.startsWith('multipart/form-data')) throw new HttpError(400, 'INVALID_INPUT', 'Dữ liệu gửi lên không hợp lệ.');
      let form;
      try { form = await req.formData(); } catch (_) { throw new HttpError(400, 'INVALID_INPUT', 'Dữ liệu gửi lên không hợp lệ.'); }
      const file = form.get('file');
      const mime = String(file?.type || '').split(';')[0].trim().toLowerCase();
      const language = String(form.get('language') || 'vi');
      const hint = String(form.get('prompt') || '').replace(/\s+/g, ' ').trim().slice(0, 700);
      if (!(file instanceof Blob) || file.size < MIN_AUDIO || file.size > MAX_AUDIO || !EXT[mime] || !LANGS.includes(language))
        throw new HttpError(400, 'INVALID_INPUT', 'Đoạn ghi âm không hợp lệ hoặc quá ngắn.');
      const rpc = async (name, args) => {
        const { data, error } = await service.rpc(name, args);
        if (error) throw new HttpError(error.code === '42501' ? 403 : 503, error.code === '42501' ? 'ACCESS_DENIED' : 'STORAGE_UNAVAILABLE', error.code === '42501' ? 'Bạn không có quyền dùng tính năng này.' : 'Không truy cập được kho key. Hãy thử lại sau.');
        return data;
      };
      if (!await rpc('kgpt_ai_consume_rate', { p_user_id: actor, p_category: 'ai' })) throw new HttpError(429, 'APP_RATE_LIMIT', 'Bạn nói quá nhanh hoặc đã hết hạn mức ngày của ứng dụng. Hãy thử lại sau.');
      const credentials = await rpc('kgpt_ai_credentials', { p_user_id: actor }) || {};
      const keys = [...new Set(['groq1', 'groq2', 'groq3'].map(n => credentials[n]?.key).filter(Boolean))];
      if (!keys.length) throw new HttpError(409, 'KEY_NOT_CONFIGURED', 'Tài khoản chưa được cấp key Groq.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let lastStatus = 502, limited = 0;
      for (const key of keys) {
        const payload = new FormData();
        payload.append('file', new Blob([bytes], { type: mime }), 'voice.' + EXT[mime]);
        payload.append('model', MODEL);
        payload.append('language', language);
        payload.append('response_format', 'verbose_json');
        payload.append('temperature', '0');
        if (hint) payload.append('prompt', hint);
        let response;
        try {
          response = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: payload, redirect: 'error', signal: AbortSignal.any([req.signal, AbortSignal.timeout(25000)]) });
        } catch (_) { throw new HttpError(504, 'PROVIDER_UNAVAILABLE', 'Không kết nối được dịch vụ nhận dạng giọng nói.'); }
        lastStatus = response.status;
        if (response.status === 429) { limited++; await response.arrayBuffer().catch(() => null); continue; }
        if ([401, 403].includes(response.status)) { await response.arrayBuffer().catch(() => null); continue; }
        if (!response.ok) { await response.arrayBuffer().catch(() => null); throw new HttpError(502, 'PROVIDER_ERROR', 'Dịch vụ nhận dạng giọng nói chưa xử lý được. Hãy thử lại.', { providerStatus: response.status }); }
        const data = await response.json().catch(() => null);
        if (!data) throw new HttpError(502, 'EMPTY_OUTPUT', 'Dịch vụ nhận dạng giọng nói chưa trả kết quả.');
        return reply({ text: cleanTranscript(data), model: MODEL, duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : undefined });
      }
      if (limited) throw new HttpError(429, 'PROVIDER_LIMIT', 'Dịch vụ nhận dạng đang hết lượt. Hãy thử lại sau ít phút.', { providerStatus: 429 });
      throw new HttpError(502, 'PROVIDER_ERROR', [401, 403].includes(lastStatus) ? 'Key Groq không hợp lệ hoặc chưa được cấp quyền.' : 'Dịch vụ nhận dạng giọng nói chưa xử lý được.', { providerStatus: lastStatus });
    } catch (error) {
      if (error instanceof HttpError) return reply({ error: error.message, code: error.code, ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}) }, error.status);
      return reply({ error: 'Backend chưa xử lý được yêu cầu. Hãy thử lại sau.', code: 'INTERNAL_ERROR' }, 500);
    }
  };
}

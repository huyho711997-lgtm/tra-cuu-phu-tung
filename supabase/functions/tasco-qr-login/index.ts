// Edge Function: đăng nhập trang Cloud máy tính bằng QR quét từ app điện thoại.
//  create  (máy tính, ẩn danh) -> {id, code, verifier, pin, expires_at}
//  poll    (máy tính)          -> {status} | {status:'approved', token_hash}   (trả 1 lần rồi xoá)
//  info    (điện thoại, JWT)   -> thông tin trình duyệt đang xin đăng nhập
//  approve (điện thoại, JWT)   -> kiểm tra mã 4 số, tối đa 5 lần sai
//  deny    (điện thoại, JWT)   -> từ chối
import { createClient } from "npm:@supabase/supabase-js@2";

const TTL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const CREATE_LIMIT = 10;              // tối đa 10 mã / 10 phút / IP
const CREATE_WINDOW_MS = 10 * 60 * 1000;

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const enc = new TextEncoder();
async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const rnd = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
function pin4() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(n).padStart(4, "0");
}
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const isTok = (s: unknown, min = 20, max = 100) =>
  typeof s === "string" && s.length >= min && s.length <= max && /^[A-Za-z0-9_-]+$/.test(s);

function clientIp(req: Request) {
  const h = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
  return h.split(",")[0].trim() || "unknown";
}
function ipHint(ip: string) {
  const p = ip.split(".");
  if (p.length === 4) return `${p[0]}.${p[1]}.*.*`;
  const q = ip.split(":");
  return q.length > 2 ? `${q[0]}:${q[1]}:*` : "ẩn";
}
function uaLabel(ua: string) {
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Trình duyệt";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Máy tính";
  return `${br} · ${os}`;
}

async function userFrom(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id || !data.user.email) return null;   // khoá anon không có user
  return data.user;
}

async function loadRow(id: string) {
  const { data } = await admin.from("tasco_qr_logins").select("*").eq("id", id).maybeSingle();
  return data as Record<string, any> | null;
}
const expired = (r: { expires_at: string }) => new Date(r.expires_at).getTime() <= Date.now();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body.action || "");

  try {
    // ---------- create: máy tính xin mã ----------
    if (action === "create") {
      const ip = clientIp(req);
      const ipH = await sha256("ip:" + ip);
      const since = new Date(Date.now() - CREATE_WINDOW_MS).toISOString();
      const { count } = await admin.from("tasco_qr_logins").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipH).gte("created_at", since);
      if ((count ?? 0) >= CREATE_LIMIT) return json({ error: "rate_limited", retry_after: 60 }, 429);
      // dọn dòng cũ
      await admin.from("tasco_qr_logins").delete().lt("expires_at", new Date(Date.now() - 3600_000).toISOString());

      const id = crypto.randomUUID();
      const code = rnd(32), verifier = rnd(32), pin = pin4();
      const expires = new Date(Date.now() + TTL_MS);
      const { error } = await admin.from("tasco_qr_logins").insert({
        id,
        code_hash: await sha256(code),
        verifier_hash: await sha256(verifier),
        pin_hash: await sha256(id + ":" + pin),
        ip_hash: ipH,
        ip_hint: ipHint(ip),
        ua_label: uaLabel(req.headers.get("user-agent") || ""),
        expires_at: expires.toISOString(),
      });
      if (error) throw error;
      return json({ id, code, verifier, pin, expires_at: expires.toISOString(), ttl: TTL_MS / 1000 });
    }

    // ---------- poll: máy tính hỏi kết quả ----------
    if (action === "poll") {
      if (!isUuid(body.id) || !isTok(body.verifier)) return json({ status: "invalid" }, 400);
      const r = await loadRow(body.id);
      if (!r) return json({ status: "expired" });
      if (!safeEq(r.verifier_hash, await sha256(body.verifier))) return json({ status: "invalid" }, 403);
      if (r.status === "approved" && r.token_hash) {
        await admin.from("tasco_qr_logins").delete().eq("id", r.id);   // dùng 1 lần
        if (expired(r) && Date.now() - new Date(r.expires_at).getTime() > 60_000) return json({ status: "expired" });
        return json({ status: "approved", token_hash: r.token_hash });
      }
      if (r.status === "denied") { await admin.from("tasco_qr_logins").delete().eq("id", r.id); return json({ status: "denied" }); }
      if (expired(r)) { await admin.from("tasco_qr_logins").delete().eq("id", r.id); return json({ status: "expired" }); }
      return json({ status: "pending", attempts_left: MAX_ATTEMPTS - r.attempts });
    }

    // ---------- các hành động từ điện thoại: cần JWT người dùng ----------
    if (action === "info" || action === "approve" || action === "deny") {
      const user = await userFrom(req);
      if (!user) return json({ error: "unauthorized" }, 401);
      if (!isUuid(body.id) || !isTok(body.code)) return json({ error: "bad_qr" }, 400);
      const r = await loadRow(body.id);
      if (!r || !safeEq(r.code_hash, await sha256(body.code))) return json({ error: "bad_qr" }, 404);
      if (r.status !== "pending") return json({ error: "used" }, 409);
      if (expired(r)) return json({ error: "expired" }, 410);

      if (action === "info") {
        return json({ ok: true, ua: r.ua_label, ip: r.ip_hint, left: Math.max(0, Math.round((new Date(r.expires_at).getTime() - Date.now()) / 1000)), attempts_left: MAX_ATTEMPTS - r.attempts });
      }
      if (action === "deny") {
        await admin.from("tasco_qr_logins").update({ status: "denied" }).eq("id", r.id);
        return json({ ok: true });
      }
      // approve
      const pin = String(body.pin ?? "");
      if (!/^\d{4}$/.test(pin)) return json({ error: "bad_pin_format" }, 400);
      if (r.attempts >= MAX_ATTEMPTS) return json({ error: "locked" }, 423);
      if (!safeEq(r.pin_hash, await sha256(r.id + ":" + pin))) {
        const attempts = r.attempts + 1;
        const upd: Record<string, unknown> = { attempts };
        if (attempts >= MAX_ATTEMPTS) upd.status = "denied";           // khoá hẳn mã này
        await admin.from("tasco_qr_logins").update(upd).eq("id", r.id).eq("status", "pending");
        return json({ error: attempts >= MAX_ATTEMPTS ? "locked" : "wrong_pin", attempts_left: Math.max(0, MAX_ATTEMPTS - attempts) }, attempts >= MAX_ATTEMPTS ? 423 : 403);
      }
      // đúng mã: phát hành token đăng nhập 1 lần cho máy tính
      const { data: link, error: lerr } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
      const th = link?.properties?.hashed_token;
      if (lerr || !th) throw lerr || new Error("no_token");
      const { data: upd } = await admin.from("tasco_qr_logins")
        .update({ status: "approved", user_id: user.id, token_hash: th })
        .eq("id", r.id).eq("status", "pending").select("id");
      if (!upd?.length) return json({ error: "used" }, 409);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("tasco-qr-login", action, e);
    return json({ error: "server" }, 500);
  }
});

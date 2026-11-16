// Edge Function: lấy dung lượng đang dùng + hạn mức gói từ Cloudinary (Admin API GET /usage).
// API Key/Secret chỉ nằm ở Supabase Secrets, KHÔNG bao giờ gửi xuống app.
//   Secrets cần đặt: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//   Chỉ trả số liệu cho người dùng đã đăng nhập VÀ có kết nối lưu trữ trùng đúng cloud name trong secret.
import { createClient } from "npm:@supabase/supabase-js@2";

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

const CACHE_MS = 10 * 60 * 1000; // Admin API giới hạn ~500 lần/giờ: cache 10 phút
let cache: { at: number; data: Record<string, unknown> } | null = null;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "unauthorized" }, 401);

  const cloud = (Deno.env.get("CLOUDINARY_CLOUD_NAME") || "").trim();
  const key = (Deno.env.get("CLOUDINARY_API_KEY") || "").trim();
  const secret = (Deno.env.get("CLOUDINARY_API_SECRET") || "").trim();
  if (!cloud || !key || !secret) return json({ available: false, reason: "not_configured" });

  // Chỉ người có kết nối lưu trữ trùng cloud name mới xem được.
  const { data: conn, error: connError } = await admin
    .from("tasco_personal_storage_connections")
    .select("cloud_name")
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (connError) return json({ error: "lookup" }, 500);
  if (!conn || String(conn.cloud_name || "").toLowerCase() !== cloud.toLowerCase()) {
    return json({ available: false, reason: "other_account" });
  }

  if (cache && Date.now() - cache.at < CACHE_MS) return json(cache.data);

  let res: Response;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/usage`, {
      headers: { Authorization: "Basic " + btoa(`${key}:${secret}`) },
      signal: AbortSignal.timeout(10000),
    });
  } catch (_) {
    return json({ available: false, reason: "network" });
  }
  if (res.status === 401 || res.status === 403) return json({ available: false, reason: "bad_credentials" });
  if (!res.ok) return json({ available: false, reason: "upstream" });

  const u = await res.json().catch(() => null) as Record<string, any> | null;
  if (!u) return json({ available: false, reason: "upstream" });

  const storageBytes = num(u.storage?.usage);
  const creditsLimit = num(u.credits?.limit);
  // Gói theo credits: 1 credit ≈ 1 GB lưu trữ (credits dùng chung với băng thông và biến đổi ảnh). Gói cũ có storage.limit bằng byte.
  const limitBytes = num(u.storage?.limit) ?? (creditsLimit ? Math.round(creditsLimit * 1e9) : null);
  const data = {
    available: true,
    plan: typeof u.plan === "string" ? u.plan : null,
    storageBytes,
    limitBytes,
    limitIsCredits: num(u.storage?.limit) === null && creditsLimit !== null,
    creditsUsed: num(u.credits?.usage),
    creditsLimit,
    creditsPercent: num(u.credits?.used_percent),
    lastUpdated: typeof u.last_updated === "string" ? u.last_updated : null,
  };
  cache = { at: Date.now(), data };
  return json(data);
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey || !req.headers.get("apikey")) return respond({ error: "Media delivery is not configured." }, 503, origin);
  let input: { media_id?: unknown; buyer_email?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Purchase details are required." }, 400, origin); }
  const mediaId = Number(input.media_id);
  const email = String(input.buyer_email || "").trim().toLowerCase();
  if (!Number.isSafeInteger(mediaId) || mediaId < 1 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter the email used at checkout and choose your media." }, 400, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: media, error: mediaError } = await db.from("media").select("id,title,file_path,is_published,price").eq("id", mediaId).eq("is_published", true).maybeSingle();
  if (mediaError || !media || Number(media.price) <= 0 || !media.file_path) return respond({ error: "This media is not configured for paid delivery." }, 404, origin);
  const { data: purchase, error: purchaseError } = await db.from("media_purchases").select("id").eq("media_id", mediaId).eq("customer_email", email).eq("payment_status", "paid").limit(1).maybeSingle();
  if (purchaseError || !purchase) return respond({ error: "We could not find a confirmed paid purchase for that email. If you just paid, wait a moment and try again." }, 403, origin);
  const { data: signed, error: signedError } = await db.storage.from("fqmma-private").createSignedUrl(media.file_path, 900, { download: true });
  if (signedError || !signed?.signedUrl) return respond({ error: "The download is temporarily unavailable. Please contact FQ MMA support." }, 502, origin);
  return respond({ url: signed.signedUrl, title: media.title, expires_in: 900 }, 200, origin);
});
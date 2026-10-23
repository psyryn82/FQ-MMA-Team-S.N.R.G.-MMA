import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const baseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: {
    ...baseHeaders,
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
    "Vary": "Origin",
  }});
}
function normalizeLivepeerStatus(value: unknown): "processing" | "ready" | "failed" {
  const status = String(value ?? "").trim().toLowerCase();
  if (["ready", "completed", "complete", "published"].includes(status)) return "ready";
  if (["failed", "error", "errored"].includes(status)) return "failed";
  // Livepeer can report waiting/queued/uploading states, but the database enum
  // intentionally stores these under the broader "processing" state.
  return "processing";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const cors = { ...baseHeaders, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "POST required" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const livepeerKey = Deno.env.get("LIVEPEER_API_KEY");
  const authorization = req.headers.get("Authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!supabaseUrl || !anonKey || !serviceKey || !livepeerKey) return respond({ error: "VOD upload service is not fully configured." }, 503, origin);
  if (!bearer || !req.headers.get("apikey")) return respond({ error: "Sign in as authorized staff to upload videos." }, 401, origin);

  const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${bearer}` } } });
  const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
  const user = authData?.user;
  if (authError || !user || !user.email_confirmed_at) return respond({ error: "A verified staff sign-in is required." }, 401, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: staff, error: staffError } = await db.from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
  if (staffError || !staff || !["admin", "content_manager", "support", "sasha"].includes(String(staff.role))) return respond({ error: "Not authorized to manage uploaded videos." }, 403, origin);

  let input: { media_id?: unknown; title?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "JSON request body required." }, 400, origin); }
  const mediaId = Number(input.media_id);
  const title = String(input.title || "").trim().slice(0, 200);
  if (!Number.isSafeInteger(mediaId) || mediaId < 1 || !title) return respond({ error: "A valid media_id and title are required." }, 400, origin);
  const { data: media, error: mediaError } = await db.from("media").select("id,title,category,livepeer_asset_id,livepeer_playback_id,storage_bucket").eq("id", mediaId).maybeSingle();
  if (mediaError || !media) return respond({ error: "Media record not found." }, 404, origin);
  if (String(media.category || "").toLowerCase() !== "video") return respond({ error: "Only uploaded video media can be sent to Livepeer." }, 400, origin);
  if (media.livepeer_asset_id || media.livepeer_playback_id) return respond({ error: "This video already has a Livepeer asset or playback ID. Check the existing asset before retrying.", asset_id: media.livepeer_asset_id, playback_id: media.livepeer_playback_id }, 409, origin);

  try {
    const lp = await fetch("https://livepeer.studio/api/asset/request-upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${livepeerKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: title, playbackPolicy: { type: "jwt" } }),
    });
    const body = await lp.json().catch(() => ({}));
    if (!lp.ok) {
      console.error("Livepeer request-upload failed", { status: lp.status, keys: Object.keys(body || {}) });
      return respond({ error: "Livepeer could not create the upload session.", provider_status: lp.status }, 502, origin);
    }
    const asset = body.asset || body;
    const tusEndpoint = body.tusEndpoint || body.tus_endpoint || body.upload?.tusEndpoint;
    const uploadUrl = body.url || body.uploadUrl || body.upload_url || body.upload?.url;
    if (!asset.id || !asset.playbackId || (!tusEndpoint && !uploadUrl)) {
      console.error("Unexpected Livepeer upload response shape", { keys: Object.keys(body || {}), assetKeys: Object.keys(asset || {}) });
      return respond({ error: "Livepeer returned an unexpected upload response. No media record was changed." }, 502, origin);
    }
    const { error: updateError } = await db.from("media").update({
      title,
      livepeer_asset_id: asset.id,
      livepeer_playback_id: asset.playbackId,
      livepeer_status: normalizeLivepeerStatus(asset.status?.phase || asset.status?.status),
      livepeer_playback_policy: "jwt",
      updated_at: new Date().toISOString(),
    }).eq("id", mediaId);
    if (updateError) {
      console.error("Could not save Livepeer asset metadata", { message: updateError.message });
      return respond({ error: "Livepeer asset was created but its metadata could not be saved. Contact an administrator before retrying.", asset_id: asset.id }, 500, origin);
    }
    return respond({ success: true, asset_id: asset.id, playback_id: asset.playbackId, status: normalizeLivepeerStatus(asset.status?.phase || asset.status?.status), tus_endpoint: tusEndpoint || null, upload_url: uploadUrl || null, upload_headers: body.headers || body.upload?.headers || {} }, 200, origin);
  } catch (error) {
    console.error("VOD upload session failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Could not create the Livepeer upload session." }, 502, origin);
  }
});

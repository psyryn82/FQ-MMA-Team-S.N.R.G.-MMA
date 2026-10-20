import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const baseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com" },
  });
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...baseHeaders, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com" } });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const livepeerKey = Deno.env.get("LIVEPEER_API_KEY");
  const authorization = req.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !serviceKey || !livepeerKey) {
    return respond({ error: "Video uploads are not configured yet. An administrator must configure the Livepeer API secret." }, 503, origin);
  }
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Sign in to the admin dashboard first." }, 401, origin);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return respond({ error: "Your admin session is not valid. Sign in again." }, 401, origin);

  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admin, error: adminError } = await adminClient.from("admin_users").select("role").eq("user_id", userData.user.id).maybeSingle();
  if (adminError || !admin || !["admin", "content_manager", "sasha"].includes(admin.role)) {
    return respond({ error: "Your account is not allowed to upload media." }, 403, origin);
  }

  let input: { name?: unknown; file_name?: unknown; file_size?: unknown; is_paid?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Video upload details are required." }, 400, origin); }
  const name = String(input.name || "").trim().slice(0, 200);
  const fileName = String(input.file_name || "video.mp4").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180);
  const fileSize = Number(input.file_size);
  const isPaid = input.is_paid === true;
  if (!name) return respond({ error: "Enter a video title before uploading." }, 400, origin);
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > 5 * 1024 * 1024 * 1024) {
    return respond({ error: "Video must be between 1 byte and 5 GB." }, 413, origin);
  }

  try {
    const response = await fetch("https://livepeer.studio/api/asset", {
      method: "POST",
      headers: { Authorization: "Bearer " + livepeerKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        playbackPolicy: { type: isPaid ? "jwt" : "public" },
        creatorId: { type: "unverified", value: userData.user.id },
        userTags: { source: "fq-snrg-mma-website", filename: fileName },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Livepeer asset creation failed", response.status);
      return respond({ error: "Livepeer could not create the video upload. Check the Livepeer account and try again." }, 502, origin);
    }
    const asset = payload.asset || payload;
    const assetId = asset.id || payload.assetId;
    const playbackId = asset.playbackId || payload.playbackId;
    const uploadUrl = payload.tusEndpoint || payload.uploadUrl || (payload.upload && payload.upload.url) || asset.tusEndpoint;
    if (!assetId || !playbackId || !uploadUrl || !/^https:\/\//i.test(String(uploadUrl))) {
      console.error("Livepeer upload response missing required fields", Object.keys(payload || {}));
      return respond({ error: "Livepeer returned an incomplete upload session. No listing was saved. Check the Livepeer API response format." }, 502, origin);
    }
    // Never return a direct download URL or original source URL to the browser.
    return respond({ assetId, playbackId, uploadUrl, playbackPolicy: isPaid ? "jwt" : "public" }, 200, origin);
  } catch (error) {
    console.error("Livepeer upload session error", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Could not connect to Livepeer. No listing was saved. Please try again." }, 502, origin);
  }
});

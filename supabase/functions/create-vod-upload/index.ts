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
    const response = await fetch("https://livepeer.studio/api/asset/request-upload", {
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
      // Extract only validation metadata and short messages. Redact URLs and
      // credential-like strings; never log the raw response or request headers.
      const redactDiagnostic = (value: unknown): string => String(value ?? "")
        .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
        .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\b(sk|pk|api[_-]?key|token|secret)[=: _-]*[A-Za-z0-9._-]{8,}/gi, "[redacted-credential]")
        .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-long-value]")
        .slice(0, 300);
      const extractSafeErrors = (value: unknown, depth = 0): unknown => {
        if (depth > 3 || value == null) return undefined;
        if (typeof value === "string") return redactDiagnostic(value);
        if (Array.isArray(value)) return value.slice(0, 5).map((item) => extractSafeErrors(item, depth + 1));
        if (typeof value === "object") {
          const input = value as Record<string, unknown>;
          const output: Record<string, unknown> = {};
          for (const key of ["field", "param", "type", "code", "message", "detail", "reason"]) {
            if (input[key] !== undefined && ["string", "number", "boolean"].includes(typeof input[key])) {
              output[key] = redactDiagnostic(input[key]);
            }
          }
          if (Object.keys(output).length) return output;
          return Object.keys(input).slice(0, 10);
        }
        return redactDiagnostic(value);
      };
      const safeErrors = extractSafeErrors((payload as Record<string, unknown> | null)?.errors);
      console.error("Livepeer asset creation failed", {
        status: response.status,
        responseKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
        validation: safeErrors ?? "No safe validation details returned",
      });
      const diagnostic = response.status === 422
        ? safeErrors
        : undefined;
      return respond({
        error: response.status === 422
          ? "Livepeer rejected the upload request. See the sanitized validation details below."
          : "Livepeer could not create the video upload. Check the Livepeer account and try again.",
        ...(diagnostic !== undefined ? { details: diagnostic } : {}),
      }, 502, origin);
    }

    // Livepeer's response may wrap the asset differently across API/SDK versions.
    // Accept only known field names and return the TUS endpoint expected by the
    // browser uploader. Do not expose any direct playback or download URLs.
    const envelope = payload && typeof payload === "object" ? payload : {};
    const data = envelope.data && typeof envelope.data === "object" ? envelope.data : envelope;
    const asset = data.asset && typeof data.asset === "object" ? data.asset
      : envelope.asset && typeof envelope.asset === "object" ? envelope.asset
      : data;
    const upload = data.upload && typeof data.upload === "object" ? data.upload
      : envelope.upload && typeof envelope.upload === "object" ? envelope.upload
      : {};
    const assetId = asset.id || data.assetId || envelope.assetId;
    const playbackId = asset.playbackId || data.playbackId || envelope.playbackId;
    const uploadUrl = data.tusEndpoint || data.tus_endpoint || data.uploadUrl ||
      envelope.tusEndpoint || envelope.tus_endpoint || envelope.uploadUrl ||
      upload.url || upload.tusEndpoint || upload.tus_endpoint ||
      asset.tusEndpoint || asset.tus_endpoint || asset.uploadUrl;
    if (!assetId || !playbackId || typeof uploadUrl !== "string" || !/^https:\/\//i.test(uploadUrl)) {
      console.error("Livepeer upload response missing required fields", {
        status: response.status,
        topLevelKeys: Object.keys(envelope),
        dataKeys: data && typeof data === "object" ? Object.keys(data) : [],
        assetKeys: asset && typeof asset === "object" ? Object.keys(asset) : [],
        uploadKeys: Object.keys(upload),
        hasAssetId: Boolean(assetId),
        hasPlaybackId: Boolean(playbackId),
        hasHttpsUploadUrl: typeof uploadUrl === "string" && /^https:\/\//i.test(uploadUrl),
      });
      return respond({ error: "Livepeer created an incomplete upload session. No listing was saved. Check the Edge Function logs for the safe response-field diagnostics, then contact support if needed." }, 502, origin);
    }
    // Never return a direct download URL or original source URL to the browser.
    return respond({ assetId, playbackId, uploadUrl, playbackPolicy: isPaid ? "jwt" : "public" }, 200, origin);
  } catch (error) {
    console.error("Livepeer upload session error", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Could not connect to Livepeer. No listing was saved. Please try again." }, 502, origin);
  }
});

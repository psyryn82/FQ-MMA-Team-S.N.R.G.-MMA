// Issues short-lived URLs only for private media whose first path segment is a membership plan UUID.
// Upload private paid media as: <plan-id>/<filename>. Never put paid files in fqmma-media.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
function respond(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Sign in to access this media." }, 401, origin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return respond({ error: "Media access is not configured." }, 503, origin);

  const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(authorization.slice(7));
  const user = authData.user;
  if (authError || !user) return respond({ error: "Your sign-in session could not be verified." }, 401, origin);

  let path = "";
  try { path = String((await req.json()).path || ""); } catch { return respond({ error: "A media path is required." }, 400, origin); }
  const segments = path.split("/");
  if (!path || path.startsWith("/") || path.includes("\\") || segments.some((part) => !part || part === "." || part === "..") || segments.length < 2) {
    return respond({ error: "Invalid private media path." }, 400, origin);
  }
  const planId = segments[0];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(planId)) {
    return respond({ error: "Private media must be stored beneath a valid membership plan ID." }, 400, origin);
  }

  const adminDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminRecord, error: adminError } = await adminDb.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (adminError) return respond({ error: "Could not verify media permissions." }, 500, origin);
  if (!adminRecord) {
    const { data: memberships, error: membershipError } = await adminDb.from("memberships")
      .select("id,current_period_end").eq("user_id", user.id).eq("plan_id", planId).eq("status", "active");
    if (membershipError) return respond({ error: "Could not verify membership access." }, 500, origin);
    const now = Date.now();
    const entitled = (memberships || []).some((m) => !m.current_period_end || Date.parse(m.current_period_end) > now);
    if (!entitled) return respond({ error: "An active membership for this media is required." }, 403, origin);
  }

  const { data, error } = await adminDb.storage.from("fqmma-private").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    console.error("Could not create private media URL", error?.message || "unknown error");
    return respond({ error: "Private media is unavailable." }, 404, origin);
  }
  return respond({ url: data.signedUrl, expires_in: 300 }, 200, origin);
});

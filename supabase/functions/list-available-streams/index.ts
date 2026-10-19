import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" };
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
  if (!["GET", "POST"].includes(req.method)) return respond({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);
  if (!req.headers.get("apikey")) return respond({ error: "A public API key is required." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return respond({ error: "Stream listings are not configured." }, 503, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: configs, error: configError } = await db.from("event_streams")
    .select("event_id,stream_price_cents,currency,livepeer_playback_id")
    .eq("is_enabled", true)
    .not("livepeer_playback_id", "is", null);
  if (configError) {
    console.error("Could not load stream listings", configError.message);
    return respond({ error: "Live-stream listings are temporarily unavailable." }, 503, origin);
  }
  if (!configs?.length) return respond({ streams: [] }, 200, origin);

  const ids = configs.map((x) => x.event_id);
  const { data: events, error: eventError } = await db.from("events")
    .select("id,title,event_date,venue,status,is_published")
    .in("id", ids)
    .in("status", ["upcoming", "live"]).eq("is_published", true);
  if (eventError) {
    console.error("Could not load stream event details", eventError.message);
    return respond({ error: "Live-stream listings are temporarily unavailable." }, 503, origin);
  }

  const eventMap = new Map((events || []).map((event) => [event.id, event]));
  const streams = configs
    .filter((config) => config.livepeer_playback_id && eventMap.has(config.event_id))
    .map((config) => {
      const event = eventMap.get(config.event_id)!;
      return {
        event_id: event.id,
        title: event.title,
        event_date: event.event_date,
        venue: event.venue,
        price_cents: config.stream_price_cents,
        currency: config.currency,
      };
    });
  return respond({ streams }, 200, origin);
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired by design: uploaded fight and portfolio videos are downloadable media only.
// Actual event livestreams use the separate event-stream functions.
const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
Deno.serve((req: Request) => {
  const origin = req.headers.get("Origin") || "";
  const cors = {
    ...headers,
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({
    error: "This endpoint is retired. Uploaded fight and portfolio videos are private downloadable media, not Livepeer VODs. Use the media uploader in admin.html. Actual event livestreams use the event stream tools."
  }), { status: 410, headers: cors });
});

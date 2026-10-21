// Deprecated: FQ MMA no longer sells memberships or recurring plans.
// Current one-time ticket, stream, and media checkout functions are separate endpoints.
Deno.serve((_req: Request) => new Response(JSON.stringify({
  error: "This checkout endpoint is retired. Use the one-time event ticket checkout instead."
}), { status: 410, headers: { "Content-Type": "application/json" } }));

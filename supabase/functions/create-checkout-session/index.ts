// Deprecated: FQ MMA no longer sells memberships or recurring plans.
// All public ticket purchases use create-ticket-checkout, which is restricted to Stripe test mode.
Deno.serve((_req: Request) => new Response(JSON.stringify({
  error: "This checkout endpoint is retired. Use the one-time event ticket checkout instead."
}), { status: 410, headers: { "Content-Type": "application/json" } }));

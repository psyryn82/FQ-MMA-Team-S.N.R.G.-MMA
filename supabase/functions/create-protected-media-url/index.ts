// Membership-based media entitlements are retired.
// Private archive uploads are admin-only. Public paid media uses an explicit purchase link.
Deno.serve((_req: Request) => new Response(JSON.stringify({
  error: "Membership media access is retired. Contact FQ MMA for a supported purchase link."
}), { status: 410, headers: { "Content-Type": "application/json" } }));

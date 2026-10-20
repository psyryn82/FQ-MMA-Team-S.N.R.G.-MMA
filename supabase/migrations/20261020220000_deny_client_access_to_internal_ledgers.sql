-- Explicitly deny client-role access to internal ledgers and rate-limit storage.
-- These tables are accessed only through trusted server-side functions.
do $$
declare t text;
begin
  foreach t in array array[
    'contact_form_rate_limits',
    'media_download_permissions',
    'media_download_tokens',
    'stripe_purchases',
    'stripe_webhook_events'
  ] loop
    execute format('drop policy if exists "Deny client access to internal table" on public.%I', t);
    execute format(
      'create policy "Deny client access to internal table" on public.%I for all to anon, authenticated using (false) with check (false)',
      t
    );
  end loop;
end
$$;

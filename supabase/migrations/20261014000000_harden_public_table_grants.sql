-- FQ MMA least-privilege grants and public content read boundary.
-- Apply only after reviewing the staged branch migration and confirming the site still works.
-- RLS remains the row-level authorization layer; SQL grants are narrowed to required operations.

begin;

-- Remove broad table privileges from browser-facing roles.
revoke all privileges on table
  public.admin_users,
  public.site_content,
  public.fighters,
  public.events,
  public.training_schedule,
  public.products,
  public.membership_plans,
  public.memberships,
  public.chat_messages,
  public.media,
  public.stripe_purchases,
  public.stripe_webhook_events,
  public.event_ticket_options,
  public.ticket_purchases,
  public.media_purchases
from anon, authenticated;

-- Public website reads only. RLS policies continue to filter rows.
grant select on table
  public.site_content,
  public.fighters,
  public.events,
  public.training_schedule,
  public.products,
  public.membership_plans,
  public.media,
  public.event_ticket_options
to anon;

-- Signed-in users may read public content and the rows their RLS policies permit.
grant select on table
  public.admin_users,
  public.site_content,
  public.fighters,
  public.events,
  public.training_schedule,
  public.products,
  public.membership_plans,
  public.memberships,
  public.chat_messages,
  public.media,
  public.event_ticket_options,
  public.ticket_purchases
to authenticated;

-- Only tables with explicit RLS admin policies receive browser-side write privileges.
-- chat_messages also permits signed-in users to INSERT their own non-admin messages.
grant insert, update, delete on table
  public.site_content,
  public.fighters,
  public.events,
  public.training_schedule,
  public.products,
  public.membership_plans,
  public.memberships,
  public.event_ticket_options,
  public.media
to authenticated;

grant insert, delete on table public.chat_messages to authenticated;

-- Purchase ledgers and webhook idempotency records are service-side only.
-- No anon/authenticated grants are re-added for ticket_purchases writes,
-- media_purchases, stripe_purchases, or stripe_webhook_events.

-- This older permissive policy made every site_content row readable publicly,
-- overriding the intended content_key='public' policy because permissive policies OR together.
drop policy if exists "Public can read published site content" on public.site_content;

commit;

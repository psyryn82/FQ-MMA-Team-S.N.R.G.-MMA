-- FQ MMA media destination and promotion checkout redemption.
-- This migration is additive. It does not deploy or change live Edge Functions.
alter table public.media
  add column if not exists media_destination text not null default 'site'
  check (media_destination in ('site', 'portfolio'));

alter table public.ticket_purchases
  add column if not exists charged_total_cents integer null check (charged_total_cents is null or charged_total_cents >= 50);

comment on column public.ticket_purchases.charged_total_cents is
  'Final amount charged at checkout after discounts; total_cents remains the original ticket reservation total.';

comment on column public.media.media_destination is
  'Editorial placement: site media or portfolio media. Independent from catalog collection, pricing, and publication state.';

create index if not exists media_destination_published_idx
  on public.media (media_destination, is_published, created_at desc);

create or replace function public.reserve_promotion_redemption(
  p_code text,
  p_purchase_type text,
  p_event_id uuid,
  p_customer_email text,
  p_original_amount_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  promo public.promotions%rowtype;
  redemption_id uuid;
  discount_cents integer;
  final_cents integer;
  normalized_code text;
begin
  normalized_code := upper(trim(coalesce(p_code, '')));
  if normalized_code = '' or length(normalized_code) > 40 then
    raise exception 'Enter a valid promotion code.';
  end if;
  if p_purchase_type not in ('ticket', 'stream') then
    raise exception 'This promotion cannot be used for that purchase.';
  end if;
  if p_original_amount_cents is null or p_original_amount_cents < 50 then
    raise exception 'Promotion discounts require a purchase of at least $0.50.';
  end if;
  if length(trim(coalesce(p_customer_email, ''))) > 320 then
    raise exception 'Enter a valid email address.';
  end if;

  select * into promo
    from public.promotions
    where code = normalized_code
    for update;

  if not found or not promo.is_active then
    raise exception 'That promotion code is not active or does not exist.';
  end if;
  if promo.starts_at is not null and promo.starts_at > now() then
    raise exception 'That promotion has not started yet.';
  end if;
  if promo.expires_at is not null and promo.expires_at <= now() then
    raise exception 'That promotion has expired.';
  end if;
  if promo.event_id is not null and promo.event_id is distinct from p_event_id then
    raise exception 'That promotion is not valid for this event.';
  end if;
  if promo.applies_to not in (p_purchase_type, 'both') then
    raise exception 'That promotion is not valid for this type of purchase.';
  end if;
  if promo.promotion_type in ('free_stream', 'free_ticket') then
    raise exception 'Complimentary access codes are not enabled at checkout yet.';
  end if;
  if promo.max_redemptions is not null and promo.redemption_count >= promo.max_redemptions then
    raise exception 'That promotion has reached its redemption limit.';
  end if;

  if promo.promotion_type = 'discount_percent' then
    discount_cents := floor(p_original_amount_cents * promo.discount_value / 100.0)::integer;
  elsif promo.promotion_type = 'discount_amount' then
    discount_cents := round(promo.discount_value * 100)::integer;
  else
    raise exception 'That promotion type is not supported at checkout.';
  end if;

  discount_cents := least(greatest(discount_cents, 0), p_original_amount_cents - 1);
  final_cents := p_original_amount_cents - discount_cents;
  if final_cents < 50 then
    raise exception 'That discount would make the purchase less than the minimum checkout amount.';
  end if;

  insert into public.promotion_redemptions (
    promotion_id, customer_email, purchase_type, event_id, status, discount_amount_cents
  ) values (
    promo.id, lower(trim(p_customer_email)), p_purchase_type, p_event_id, 'pending', discount_cents
  ) returning id into redemption_id;

  update public.promotions
    set redemption_count = redemption_count + 1, updated_at = now()
    where id = promo.id;

  return jsonb_build_object(
    'redemption_id', redemption_id,
    'promotion_id', promo.id,
    'promotion_type', promo.promotion_type,
    'discount_amount_cents', discount_cents,
    'final_amount_cents', final_cents
  );
end;
$$;

create or replace function public.finish_promotion_redemption(
  p_redemption_id uuid,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  redemption public.promotion_redemptions%rowtype;
begin
  if p_outcome not in ('redeemed', 'released') then
    raise exception 'Invalid redemption outcome.';
  end if;

  select * into redemption
    from public.promotion_redemptions
    where id = p_redemption_id
    for update;

  if not found then return false; end if;
  if redemption.status = p_outcome then return true; end if;
  if redemption.status <> 'pending' then return false; end if;

  update public.promotion_redemptions
    set status = p_outcome,
        redeemed_at = case when p_outcome = 'redeemed' then now() else null end
    where id = p_redemption_id;

  if p_outcome = 'released' then
    update public.promotions
      set redemption_count = greatest(0, redemption_count - 1), updated_at = now()
      where id = redemption.promotion_id;
  end if;
  return true;
end;
$$;

revoke all on function public.reserve_promotion_redemption(text, text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finish_promotion_redemption(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_promotion_redemption(text, text, uuid, text, integer) to service_role;
grant execute on function public.finish_promotion_redemption(uuid, text) to service_role;

comment on function public.reserve_promotion_redemption(text, text, uuid, text, integer) is
  'Atomically validates and reserves a percentage/fixed discount redemption for server-side checkout. Complimentary access is intentionally rejected until entitlement delivery is implemented.';

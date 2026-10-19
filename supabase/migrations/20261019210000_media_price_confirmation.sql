-- Keep a stored $0 distinct from an explicitly confirmed free item.
alter table public.media
  add column if not exists price_confirmed boolean not null default false;

comment on column public.media.price_confirmed is
  'True only after an administrator explicitly confirms the listed price, including explicitly confirming $0 means free. False means price needs review and the item must not be publicly purchasable or downloadable.';

-- Existing prices cannot be assumed correct merely because a numeric value exists.
update public.media set price_confirmed = false;

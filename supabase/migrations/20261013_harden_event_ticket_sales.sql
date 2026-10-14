-- Tighten browser grants and ensure refunded tickets no longer consume available inventory.
revoke all on public.event_ticket_options from public, anon, authenticated;
grant select on public.event_ticket_options to anon, authenticated;
grant insert, update, delete on public.event_ticket_options to authenticated;
grant all on public.event_ticket_options to service_role;
revoke all on public.ticket_purchases from public, anon, authenticated;
grant select on public.ticket_purchases to authenticated;
grant all on public.ticket_purchases to service_role;

create or replace function public.reserve_event_ticket_purchase(
  p_ticket_option_id uuid, p_quantity integer, p_buyer_email text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_option public.event_ticket_options%rowtype;
  v_event_status text;
  v_committed integer;
  v_reserved integer;
  v_purchase_id uuid;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then raise exception 'Quantity must be between 1 and 10'; end if;
  if p_buyer_email is null or length(trim(p_buyer_email)) < 5 or length(p_buyer_email) > 320 then raise exception 'A valid buyer email is required'; end if;
  select * into v_option from public.event_ticket_options where id = p_ticket_option_id for update;
  if not found or not v_option.is_available or v_option.event_id is null then raise exception 'Ticket option is not available'; end if;
  select status into v_event_status from public.events where id = v_option.event_id;
  if v_event_status is null or v_event_status not in ('upcoming','live') then raise exception 'Event is not available for ticket sales'; end if;
  if v_option.quantity_limit is not null then
    select coalesce(sum(quantity),0)::integer into v_committed from public.ticket_purchases where ticket_option_id = v_option.id and status = 'paid';
    select coalesce(sum(quantity),0)::integer into v_reserved from public.ticket_purchases where ticket_option_id = v_option.id and status = 'pending' and expires_at > now();
    if v_committed + v_reserved + p_quantity > v_option.quantity_limit then raise exception 'Not enough tickets remain at this price'; end if;
  end if;
  insert into public.ticket_purchases(ticket_option_id,event_id,buyer_email,quantity,unit_price_cents,total_cents,currency,status)
  values (v_option.id,v_option.event_id,lower(trim(p_buyer_email)),p_quantity,v_option.price_cents,v_option.price_cents*p_quantity,v_option.currency,'pending')
  returning id into v_purchase_id;
  return v_purchase_id;
end;
$$;
revoke all on function public.reserve_event_ticket_purchase(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.reserve_event_ticket_purchase(uuid,integer,text) to service_role;

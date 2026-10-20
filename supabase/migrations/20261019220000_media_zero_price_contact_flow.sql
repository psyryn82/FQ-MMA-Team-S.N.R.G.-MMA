-- Clarify that zero-price media listings are contact-for-purchase, not free.
comment on column public.media.price_confirmed is
  'True means the administrator confirmed the pricing behavior. A price above zero is a fixed purchase price; a price of zero means contact us for purchasing details and does not mean free.';

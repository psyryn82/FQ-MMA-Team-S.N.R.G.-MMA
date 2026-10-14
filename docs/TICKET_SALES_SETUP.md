# FQ MMA one-time ticket sales

## Ticket options in the admin dashboard
1. Create or edit an event under **Events**. The date can remain blank while planning, but set its status to **Upcoming** or **Live** before selling tickets.
2. Open **Ticket options** and create a ticket name, description, fixed price, currency, and optional quantity limit.
3. Leave **Allow customers to buy** turned off while preparing. You can save options without linking an event yet.
4. When ready, link the option to its event and turn sales on. The public Events schedule will display a purchase button.
5. Use **Ticket purchases** to review read-only purchase records. A purchase is marked paid only by the signed Stripe webhook. Do not treat a pending checkout as a paid ticket.

## Payment safety and testing
- The checkout Edge Function explicitly accepts only a Stripe test secret key (sk_test_...). It refuses to create a checkout if a live secret is configured.
- The Stripe webhook is configured in test mode for one-time Checkout events, expiry/failure, and refunds.
- Inventory reservations are serialized in Postgres. Pending reservations expire, paid tickets count against the optional limit, and refunded tickets release capacity.
- Buyer email is collected at Checkout, and a Stripe payment receipt is requested. The website does not yet issue QR codes, printable tickets, or an automated event-entry credential. Keep the endpoint test-only until that fulfillment workflow and a full test-mode purchase are verified.

## Media purchases
- **Media & purchase links** in the admin dashboard publishes media listings and external purchase URLs. Use a verified provider checkout/payment link for the item.
- Public and private archive uploads are separate. Private archive uploads are admin-only and are not automatically delivered after payment.
- The retired membership checkout and membership-based private-media URL endpoints return 410 Gone. The legacy empty membership tables are intentionally retained for now to avoid destructive schema cleanup.

## Database objects
- event_ticket_options: admin-managed ticket options, optional event link, fixed price, optional quantity limit, manual availability switch.
- ticket_purchases: server-managed pending/paid/failed/refunded records with unique Stripe Checkout Session and Payment Intent IDs.
- reserve_event_ticket_purchase(...): service-role-only reservation RPC with capacity checks and a basic per-email checkout-attempt limit.
- stripe_webhook_events: idempotency ledger for Stripe webhook deliveries.
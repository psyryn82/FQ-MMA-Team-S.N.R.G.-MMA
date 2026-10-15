# Supabase Upgrade and Media Storage Cost Review

**Prepared:** October 15, 2026  
**Purpose:** Team discussion and budgeting only  
**Status:** No upgrade, purchase, production change, or deployment is authorized by this note.

## Recommendation

Plan around **Supabase Pro at $25/month as the starting budget**, subject to checking the current billing screen and agreeing as a team before upgrading. The project is currently on the Free plan. Pro is the practical option to evaluate for paid media uploads, but upgrading alone will not finish or validate the website's upload and purchase workflows.

## Current situation

- Supabase organization: **FQ MMA / Team S.N.R.G. MMA**
- Current plan: **Free**
- Project region: **US East**
- The admin uploader currently imposes a **50 MB** file limit and uses standard Supabase Storage uploads.
- The agreed target for video uploads is **up to 2 GB per video**.
- The current media design separates Sasha's portfolio media from MMA event media. Public/free media and paid/private media use separate storage buckets.
- Sasha's booking flow is **request first**. Admin reviews the request and, if approved, sends a payment or deposit link. There are **no memberships**.

## Supabase plan comparison

| Item | Free plan (current) | Pro (budget option) |
|---|---:|---:|
| Starting price | $0/month | $25/month |
| Included file storage | 1 GB | 100 GB |
| Included uncached egress | 5 GB | 250 GB |
| Included cached egress | 5 GB | 250 GB |
| Current Free upload cap | 50 MB | Larger upload limits supported; configure the app's intended 2 GB cap |
| Backups | No automatic daily backups included on Free | Daily backups retained for 7 days |

**Published Pro overage rates to budget against:** storage $0.0213 per GB-month; uncached egress $0.09 per GB; cached egress $0.03 per GB. Actual billing depends on usage, plan terms, and current pricing. Confirm the live pricing and usage definitions before making a decision.

## Paid features and implementation work needed

1. **Raise the applicable storage upload limits** so 2 GB video files are permitted at the project and bucket levels.
2. **Update the admin uploader** from its current 50 MB UI limit to the agreed 2 GB limit. The interface must validate file type and size and show clear progress/errors.
3. **Implement resumable uploads** for large videos. Supabase recommends resumable uploads for files over 6 MB; simply increasing a limit does not make the existing standard upload resumable.
4. **Verify access controls:** public/free files must remain separate from paid/private files; private purchase downloads must continue to require verified payment and an authorized short-lived URL.
5. **Test the complete purchase path:** media selection, Stripe Checkout, payment confirmation/webhook, purchase record, and successful authorized download. Test failed/cancelled payments too.
6. **Set usage monitoring and budget checks** for storage and egress so the team can see if use is approaching included allowances.

## Other costs that are separate

- **Stripe:** payment processing fees are separate from Supabase. Confirm current Stripe pricing for the account and payment methods; fees depend on transaction details.
- **Live streaming/video delivery:** any Livepeer or other streaming/video service charges are separate. This note does not estimate those costs or mark the stream ready for testing.
- **Domain, hosting, or other vendors:** review separately if applicable. Do not assume a Supabase upgrade pays for them.

## Suggested team decision

- [ ] Agree whether the $25/month Supabase Pro starting cost is acceptable.
- [ ] Check the live Supabase billing page, included quotas, and any applicable taxes/overages before upgrading.
- [ ] Approve a reasonable monthly usage budget and who will monitor it.
- [ ] After approval, upgrade the plan and implement/test the 2 GB resumable uploader and full paid-media flow.
- [ ] Keep live-stream readiness on its own checklist; it is not covered or verified by this upgrade note.

## Official references

- Supabase pricing: https://supabase.com/pricing
- Supabase Storage pricing: https://supabase.com/docs/guides/storage/pricing
- Supabase egress and usage: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Supabase file upload limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Stripe pricing: https://stripe.com/pricing

*Planning note only. Prices, included quotas, and vendor terms can change. Recheck official pricing before committing to a paid plan.*

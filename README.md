# Bead Different Co.

The supplied reference image is preserved unchanged as the storefront’s top-half visual source. Transparent links map the visible navigation, hero CTA, and category buttons to a blank page below using URL hash filters.

Open `index.html` directly or serve this folder with a static web server.

Repository governance and canonical ownership rules are defined in `AGENTS.md`.

## Supabase setup

The backend schema and RLS policies are recorded in `supabase/migrations/`. The browser uses the project URL and publishable key only; privileged keys must remain server-side. The configured live Supabase project has applied the audit migrations through `20260920175946_require_test_checkout_flag`: the security hardening migration restores only the intended anonymous catalog RPC execution and removes write-class grants from the storefront controls view, the analytics migration adds SKU attribution, the obsolete pre-v2 category RPC is no longer executable, internal freeze helper RPCs are no longer directly callable by browser roles, and test checkout rejects direct calls that omit the explicit test flag. The local migration directory also contains historical/superseded timestamp variants; do not replay or delete those files without reconciling the live ledger first.

New accounts are created as `customer` profiles by the Auth trigger. To create the owner admin account, first register the owner through `account.html`, confirm the email if Supabase email confirmation is enabled, then run this statement in the Supabase SQL editor with the owner email substituted:

```sql
update public.profiles
set role = 'admin', updated_at = timezone('utc', now())
where lower(email) = lower('owner@example.com');
```

The admin page checks both `role = 'admin'` and `status = 'active'`. Catalog, inventory visibility, waitlist requests, review moderation, and promotions use Supabase when configured. Admin direct emails, campaigns, order updates, and restock notifications are sent through the `send-store-email` or `send-restock-notifications` Edge Functions, with Resend credentials kept in Supabase secrets. Supabase Auth signup confirmations and password recovery messages use the project's Resend-backed Send Email Hook.

### Resend email setup

Set these Supabase Edge Function secrets without committing them to the repository:

- `RESEND_API_KEY`: the Resend API key.
- `EMAIL_FROM`: a sender such as `Bead Different Co. <hello@mail.beaddifferentco.com>` on the verified Resend domain.

Deploy the email functions after changing their source: `supabase functions deploy send-store-email`, `supabase functions deploy send-restock-notifications`, `supabase functions deploy send-order-email`, and `supabase functions deploy send-auth-email`. The live `send-order-email` function is currently version 13 and accepts either an authenticated owner or an opaque guest-order token; the function performs the ownership check itself, so its gateway JWT verification is intentionally disabled for guest checkout. Order confirmations, status/tracking updates, restock notices, admin direct emails, and campaigns use the Resend API. In Supabase Authentication settings, configure the Send Email Hook URL as `https://zejcuqhihbfpuwsjvmhc.supabase.co/functions/v1/send-auth-email`, generate the hook secret there, and set that same value as `SEND_EMAIL_HOOK_SECRET` alongside `RESEND_API_KEY` and `EMAIL_FROM`; this makes signup and password-recovery templates use the Resend API too. Until that hook is enabled, Auth confirmation and recovery messages continue using the custom SMTP connection to Resend (`smtp.resend.com`, port `465` or `587`, username `resend`, and the Resend API key as the password). Do not put either API key in browser code.

Automatic signup confirmation, password recovery, order confirmation, order/tracking updates, and restock emails use the built-in branded HTML templates in the Edge Functions. Direct member emails and saved campaigns intentionally keep the administrator's typed subject and message.

Campaign drafts support all subscribers and member opt-ins, member opt-ins only, non-member subscribers only, or waitlisted customers. When a newsletter subscriber email matches a registered profile, the database links the records by email and activates that member's marketing opt-in. Declining marketing opt-in removes the matching footer-subscriber record as well.

Product records also support admin-managed estimated cost, low-stock thresholds, and searchable badge labels. The admin inventory section supports stock additions, a low-stock print view, and a spreadsheet-ready CSV export; sales totals remain dependent on populated order data.

### Etsy connection

The `etsy-connect` Edge Function provides administrator-only OAuth start, status, verification and disconnect actions. Its GET callback uses expiring, single-use state and PKCE, so deploy it with `verify_jwt=false`; POST actions independently validate the user's Supabase session and active admin profile. Set `ETSY_API_KEY` (Etsy keystring) and `ETSY_SHARED_SECRET` in Edge Function secrets. Never put them in browser code.

Register `https://zejcuqhihbfpuwsjvmhc.supabase.co/functions/v1/etsy-connect/callback` exactly as the redirect URI in Etsy. After the frontend is released, use **Store Control → Etsy connection → Connect Etsy**. The callback returns to the admin origin that initiated the connection. Access is read-only (`shops_r listings_r transactions_r`). Verification refreshes expired tokens and reads one receipt to check access. **Store Control → Etsy imports** prepares 25-record previews for orders/sales and product reviews. The administrator reviews each preview, then explicitly imports it. Order imports write revenue, discounts, shipping, tax, Etsy payment fees, refunds, and sale lines; they use saved Etsy SKU mappings for guarded inventory adjustments. Re-importing adjusts inventory only for a changed quantity. Review imports use an exact Etsy listing-to-product mapping and save the matched review as an ordinary approved item review, including its Etsy review photo when available. No review imports until its listing has one exact product match.

The OAuth tables have RLS enabled and all browser-role privileges revoked, intentionally with no browser policies. Only the backend service role can access tokens. Disconnect removes stored tokens and outstanding authorization attempts; Etsy-side authorization can also be revoked in the Etsy account. The repository contains the backend migration and Edge Function sources; verify the live Supabase migration and function versions before release because local source changes are not production-deployed automatically. OAuth consent and connection verification are complete for the configured project.

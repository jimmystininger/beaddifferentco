# Bead Different Co.

The supplied reference image is preserved unchanged as the storefront’s top-half visual source. Transparent links map the visible navigation, hero CTA, and category buttons to a blank page below using URL hash filters.

Open `index.html` directly or serve this folder with a static web server.

Repository governance and canonical ownership rules are defined in `AGENTS.md`.

## Supabase setup

The backend schema and RLS policies are recorded in `supabase/migrations/`. The browser uses the project URL and publishable key only; privileged keys must remain server-side. The customer-account, persistent-cart, favorites, email-draft, and notification-subscriber migrations are prepared locally and still require an explicit Supabase migration run before those cloud tables are available.

New accounts are created as `customer` profiles by the Auth trigger. To create the owner admin account, first register the owner through `account.html`, confirm the email if Supabase email confirmation is enabled, then run this statement in the Supabase SQL editor with the owner email substituted:

```sql
update public.profiles
set role = 'admin', updated_at = timezone('utc', now())
where lower(email) = lower('owner@example.com');
```

The admin page checks both `role = 'admin'` and `status = 'active'`. Catalog, inventory visibility, waitlist requests, review moderation, and promotions use Supabase when configured. Orders and member notes remain prototype-only until checkout and customer messaging are connected to their backend workflows. Email drafts and `mailto:` launchers are available now; actual delivery is intentionally deferred until the Resend integration is authorized and configured.

Product records also support admin-managed estimated cost, low-stock thresholds, and searchable badge labels. The admin inventory section supports stock additions, a low-stock print view, and a spreadsheet-ready CSV export; sales totals remain dependent on populated order data.

# Bead Different Co.

The supplied reference image is preserved unchanged as the storefront’s top-half visual source. Transparent links map the visible navigation, hero CTA, and category buttons to a blank page below using URL hash filters.

Open `index.html` directly or serve this folder with a static web server.

Repository governance and canonical ownership rules are defined in `AGENTS.md`.

## Supabase setup

The backend schema and RLS policies are recorded in `supabase/migrations/` and have been applied to project `zejcuqhihbfpuwsjvmhc`. The browser uses the project URL and publishable key only; privileged keys must remain server-side.

New accounts are created as `customer` profiles by the Auth trigger. To create the owner admin account, first register the owner through `account.html`, confirm the email if Supabase email confirmation is enabled, then run this statement in the Supabase SQL editor with the owner email substituted:

```sql
update public.profiles
set role = 'admin', updated_at = timezone('utc', now())
where lower(email) = lower('owner@example.com');
```

The admin page checks both `role = 'admin'` and `status = 'active'`. Catalog, inventory visibility, waitlist requests, review moderation, and promotions use Supabase when configured. Orders and member notes remain prototype-only until checkout and customer messaging are connected to their backend workflows.

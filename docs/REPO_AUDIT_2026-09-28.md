# Repository and platform audit — 2026-09-28

## Canonical status

- The local checkout was at `main` commit `06e8cd91675ca08394bc4621d69f3a5de1241ad0`, matching `origin/main` when this audit began.
- Vercel production was healthy and deployed that same commit (`dpl_ETLonaQQhBEvsdQSg6CqKUkQkAr8`).
- Supabase project `zejcuqhihbfpuwsjvmhc` is `ACTIVE_HEALTHY` in `us-east-1`.
- The current local batch was not released by this audit. Local edits must pass the repository checks before they can become the GitHub and Vercel canonical release.

## Supabase migration drift

- Supabase reports 190 applied migrations through `20260927011555 profile_model_nude_option`.
- The checkout contained nine additional migration files whose timestamps and names do not match the remote migration ledger. Several local timestamps are duplicated, and multiple files correspond semantically to migrations already applied remotely under generated names. They were moved intact to the dated external audit archive `C:\Users\jimmy\AppData\Local\Temp\bead-different-co-migration-audit-20260928` so they cannot be committed accidentally.
- The Supabase CLI link attempt was rejected as unauthorized. No migration was replayed, deleted, or fabricated to hide the mismatch.
- Resolution requires an authenticated Supabase migration reconciliation (`migration repair`/pull review) before these files can be committed or removed. Until then, the unmatched migration files remain an explicit release blocker rather than a second schema source.

## Egress and report paths

- The live application uses paginated public catalog reads, bounded storefront lists, page-scoped inventory/media reads, batch option lookups, server-side admin metric/report RPCs, and catalog snapshot parts rather than repeatedly downloading the full catalog.
- Etsy reporting currently reads new canonical `etsy_sale_lines` together with the historical `etsy_import_sales` rows and de-duplicates by order/line. The historical table contains 31,106 rows while `etsy_sale_lines` is currently empty, so deleting that table would delete the only source for existing Etsy history.
- Inventory and report indexes/RPCs are present and are used by the targeted admin catalog, inventory, recipe, and report paths. No broad index deletion was performed from advisor suggestions because those suggestions require workload-specific validation.
- Read-only relation sizing shows `etsy_import_sales` is the dominant listed table at about 101 MB for 31,106 rows; `inventory_skus` is about 18 MB and `products` about 16 MB. This supports keeping historical Etsy data but also makes future import deduplication and bounded reporting the highest-value storage/egress controls.

## Platform findings

- Supabase security advisors still report the two intentional RLS-without-policy OAuth tables, two security-definer public views, and callable security-definer functions. These were not changed blindly because their public/admin contracts require a separate policy review.
- Supabase performance advisors still report unused-index and multiple-permissive-policy findings. These are audit findings, not proof that the indexes or policies are safe to remove.
- Recent logs included HTTP 402 responses from crawler traffic during a prior window, but the project is currently healthy. The logs do not prove that Supabase restrictions are active now.
- Storage reference cleanup could not be completed without a service-role credential. No storage object was deleted, and no service-role key was added to the repository or browser code.

## Required next step

1. Authenticate the local Supabase CLI and reconcile the migration ledger against the remote project.
2. Review the final local diff, run syntax and affected-flow checks, then push the approved batch to GitHub.
3. Confirm the resulting Vercel production deployment is `READY` and carries the pushed commit.

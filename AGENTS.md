# Repository Governance

This file is the canonical operating contract for the Bead Different Co. website repository. Current files on the active working branch are the local working truth; the protected GitHub default branch is the canonical released truth once the repository is established. Conversation history, screenshots, exports, and Git history are context only and do not override current source.

## Change Classification

Every request is classified before implementation as exactly one of:

- `Repair`: restore already-approved behavior without changing product meaning, wording, architecture, contracts, schema, privacy, dependencies, or release boundaries.
- `Product Change`: change behavior, wording, architecture, contracts, schema, privacy, dependencies, governance, or release boundaries.

This repository-governance adoption is a `Product Change`. Its authorized scope is governance documentation and canonical ownership mapping only. Product behavior changes require a separate explicit request.

## Local Batch Workflow

- A batch is one explicitly authorized scope implemented locally and submitted as one pull request, even when it contains multiple related commits or many files.
- Local work may use a feature branch or approved working branch. Editing canonical owners locally is expected; local edits are not parallel implementations.
- Scope is locked at the batch/pull-request level, not per file or per local commit. Related changes within that scope may be developed and committed incrementally.
- Run fast local checks before pushing. GitHub checks are authoritative for the final candidate commit in the pull request.
- Review the complete pull-request diff against its base branch. Do not require every intermediate local commit to independently represent a releasable state.
- Adding a commit invalidates the prior verification result; all applicable checks must run again for the new final commit.
- Keep scratch files, generated artifacts, and experiments outside the repository or in explicitly ignored paths. Do not commit temporary or parallel implementations.
- A batch is complete only after the pull-request checks, affected browser/device flow, and final merged commit are verified.

## Canonical Owners

| Concern | Canonical owner | Current state |
|---|---|---|
| Governance and change control | `AGENTS.md` | This file |
| Product behavior and shared storefront behavior | `header.js`, `store.js`, `page.js`, `script.js`, `product-page.js` | Static browser implementation |
| Product configuration | `product-config.js` | Static/local prototype configuration |
| Catalog source data | `etsy-listings.csv` | Imported listing data |
| Markup and page composition | The individual `.html` entry file for each route | Static HTML routes |
| Styling | `styles.css` | Shared stylesheet |
| Tests and safeguards | No canonical test suite exists | Required checks are syntax checks and affected-flow verification until a test owner is added |
| CI | GitHub Actions after repository setup | Not configured in this local folder |
| Deployment | No deployment configuration exists | Local/static preview only |
| Database and schema | No database or schema exists | Browser `localStorage` prototype only |
| Project status | `README.md` | Minimal project status only |

If two owners conflict, stop and reconcile the conflict before editing. Do not invent a third source of truth.

## Scope and Editing Rules

- Read applicable `AGENTS.md` files and canonical owners before editing.
- Freeze the explicitly authorized scope before implementation.
- Edit the canonical owner directly.
- Keep one current implementation of each behavior; do not add patches, hotfixes, backups, temporary copies, `-fixed`, `-v2`, replacement, or parallel implementations.
- Do not create page-specific forks of shared systems.
- Preserve unrelated existing changes and do not perform opportunistic cleanup.
- Treat newly discovered issues as notes unless the user explicitly adds them to scope.
- Do not restore obsolete code because it is easier.
- Keep this repository isolated from unrelated projects.

## Data, Privacy, and Release Safeguards

- Current files on the active working branch define local working truth; the protected GitHub default branch defines released truth after merge. History is an archive, not a second specification.
- Database migrations, when introduced, are immutable ordered history; future changes use new migrations.
- Shared behavior belongs in reusable canonical systems.
- Tests are safeguards and must not be weakened or rewritten to make implementation pass.
- Governance checks must come from trusted canonical logic, not candidate code that can replace its own judge.
- Do not claim a branch, release, deployment, migration, or feature is complete unless it is verified in the real affected flow.
- Clearly report anything partial, unverified, local-only, preview-only, or blocked.
- The current profile, waitlist, review, and admin prototypes use browser `localStorage`; they are not production authentication, authorization, payment, or database controls.

## Required Verification

Before claiming completion:

1. Inspect the complete final batch diff against its GitHub pull-request base. Intermediate local commits do not need separate completion claims.
2. Run fast local checks before pushing, including `node --check` for every changed JavaScript file.
3. Run the same governance and application checks in trusted GitHub Actions against the exact pull-request commit.
4. Verify the real affected user flow in the local preview and, where applicable, on representative device sizes.
5. Use representative populated data for catalog, order, review, and admin changes.
6. Re-run final verification after every later commit; previous results are invalid once the candidate changes.
7. Report local-only, preview-only, branch-only, unmerged, or otherwise unverified work as incomplete.

When uncertain, preserve existing canonical behavior and ask before expanding scope.

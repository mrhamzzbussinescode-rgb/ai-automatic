# Phase 1 Architecture Baseline

Date: 2026-11-11

## Product goal and first release

Build a multi-tenant social media workspace where a user can sign in, manage an isolated workspace, draft content, view real connected-account status, and inspect traceable AI proposals. Phase 1 establishes those boundaries and extension points. It does not claim that a platform is connected, that analytics exist, or that a post was published unless a real authorized provider confirms it.

## Confirmed requirements

- Laravel 12, PHP, React, Inertia.js, TypeScript, Tailwind CSS, MySQL, Redis queues, Laravel Reverb.
- Official provider APIs and OAuth only; no scraping or artificial engagement.
- Tenant-owned data is isolated and every meaningful workflow is auditable.
- AI output remains a proposal until configured and approved.
- Provider capabilities remain separate; unsupported features are clearly unavailable.
- The existing Node/SQLite starter and all current uncommitted changes must be preserved.

## Assumptions and limitations

- Keep the current Node starter at repository root. Create the Laravel application in `apps/web` instead of overwriting the existing app.
- Phase 1 is a secure foundation, not a production deployment. Production requires managed MySQL/Redis, TLS, secret management, backups, monitoring, threat review, and load validation.
- Phase 1 defines provider and AI contracts; it does not perform real social publishing, automated comment replies, or fabricate analytics.
- No PHP, Composer, MySQL, Redis, Docker/Podman, or WSL runtime is available in the current environment. Laravel code cannot be installed, executed, or tested until a supported PHP/Composer environment and required services are provided.

## Architecture

```text
Browser
  React + Inertia pages
       │ same-origin session and CSRF
       ▼
Laravel modular monolith
  Auth → Workspace/Tenant policy → Domain services → Provider/AI contracts
       │                           │
       │                           ├─ OAuth provider adapters (unconfigured in Phase 1)
       │                           └─ AI provider adapter (draft-only, unconfigured in Phase 1)
       ├─ MySQL: users, workspaces, drafts, connection metadata, audit events
       ├─ Redis: queue, cache, locks, rate-limit store
       └─ Reverb: authenticated workspace-scoped events
```

Use Laravel's React/Inertia starter kit for same-origin web UI and session authentication. Keep business rules in services and policies rather than controllers. Resolve the active workspace from the authenticated membership on the server; never trust a workspace ID supplied by the browser. Queue long-running AI and provider operations with idempotency keys and persist each run before dispatch. Emit Reverb events only after the owning workspace has been verified.

Laravel 12 supports PHP 8.2–8.5; its security-fix period ends February 24, 2027. This is close for a new long-lived SaaS. The requested version is retained in this plan, but the team should choose Laravel 13 before production if the version instruction can change. [Laravel release and support dates](https://laravel.com/framework/docs/12.x/releases)

## Proposed project structure

```text
apps/
  web/                         # Laravel 12 application; isolated from the existing Node starter
    app/
      Contracts/               # SocialPlatformAdapter, AiProvider, VideoStorage
      Domain/
        Accounts/              # account linking and capability state
        Audit/                 # redacted append-only workflow events
        Content/               # drafts and revisions
        Tenancy/               # workspace context and tenant policies
      Http/Controllers/
      Jobs/                    # only persisted/idempotent background jobs
      Models/
      Policies/
      Services/
    database/migrations/
    resources/js/               # Inertia React pages and shared components
    routes/
    tests/Feature/
    tests/Unit/
packages/
  provider-contracts/           # shared DTOs/capability types only when a second app needs them
docs/
  architecture/                # provider capability notes and decision records
```

The `packages/provider-contracts` directory is a future seam, not a Phase 1 package until a second consumer exists. The existing repository root remains unchanged.

## Phase 1 database design

Use UUID primary keys where records cross APIs. Add `workspace_id` to every tenant-owned table and enforce ownership with both policies and tenant-scoped queries. Foreign keys, unique constraints, and indexes should reflect the workspace boundary.

| Table | Key fields and purpose |
|---|---|
| `users` | id, name, unique normalized email, password hash, email verification timestamps, created/updated timestamps. |
| `workspaces` | id, name, owner_user_id, created/updated timestamps. |
| `workspace_memberships` | workspace_id, user_id, role, status, joined_at; unique `(workspace_id, user_id)`. |
| `social_accounts` | id, workspace_id, provider, provider_account_id, display_name, connection_status, granted_scopes, token ciphertext fields, expiry/revocation timestamps; unique `(workspace_id, provider, provider_account_id)`. Never return token fields to clients. |
| `content_items` | id, workspace_id, created_by, platform, title, body, status (`draft` in Phase 1), content metadata JSON, created/updated timestamps. |
| `ai_runs` | id, workspace_id, requested_by, provider/model, status, input/output references, usage/cost metadata, idempotency key, timestamps. Keep secrets and unrelated tenant content out of logs. |
| `audit_events` | id, workspace_id, actor_user_id, action, target_type/id, redacted metadata JSON, correlation_id, created_at. Append-only for application workflows. |

Laravel's authentication/session tables and cache/queue tables are framework-managed as appropriate. Avoid storing video binaries in MySQL; Phase 2+ should use private object storage with tenant-scoped access and signed downloads.

## Security, permissions, and workflow traceability

- Authentication uses Laravel's server-side session cookie, CSRF protection, password hashing, login throttling, and verification/recovery flows before public launch.
- `WorkspaceContext` resolves the active tenant from the authenticated user. Policies check membership and role for every resource operation; tests must attempt cross-workspace reads, updates, and deletes.
- OAuth uses state validation, exact redirect URIs, least-privilege scopes, token refresh/revocation where supported, server-side encrypted token storage, and no secrets in logs or Inertia props.
- Provider adapter methods expose explicit capabilities and return typed outcomes. No adapter means `not_connected`/`unsupported`, never simulated success.
- Persist a workflow/run record before enqueueing work; pass idempotency keys to side effects, bound retries, and record provider request IDs/status without recording tokens or raw private content.
- Provide workspace-scoped pause/stop controls before enabling any recurring jobs. Phase 1 has no autonomous publication job.

## Provider and AI integration requirements

- Keep one adapter per provider and record approved scopes and capability state per connected account.
- A YouTube publishing implementation needs a Google Cloud project, YouTube Data API enabled, OAuth web credentials, an approved redirect URI, and channel-owner OAuth consent. Upload/schedule scope and public app verification must be reviewed before release.
- TikTok and Meta/Instagram require developer apps, platform-specific permission review, account-type eligibility, and app approval. X, LinkedIn, and Pinterest have separate API products, access tiers, and write restrictions. Verify current official documentation at the time each adapter is implemented.
- AI generation requires a selected provider, server-side API credentials, per-workspace usage limits, budget controls, retention policy, and human approval behavior. Costs depend on model, media duration, and generated assets.
- Production scheduling requires managed Redis and workers. Reverb needs authenticated channel authorization and horizontal scaling design before multi-instance deployment.

## Roadmap and acceptance criteria

### Phase 1 — core foundation

1. Create the isolated Laravel application and React/Inertia shell.
2. Implement registration, sign-in/out, session security, workspace creation, memberships, and role policies.
3. Implement tenant-scoped content draft CRUD and a real dashboard backed only by stored data.
4. Add provider/AI contracts, connection status model, audit events, and an AI proposal record that is not presented as a completed provider action.
5. Add unit/feature tests for authentication, authorization, cross-tenant isolation, draft lifecycle, redaction, and audit persistence; run them against MySQL and type/lint/build checks.

**Phase 1 is complete only when** a new account receives an isolated workspace; a second workspace cannot read or mutate its records; drafts persist; every workflow event is traceable and redacted; provider state is honest; and all prescribed checks pass in the Laravel runtime.

### Later phases

- **Phase 2:** AI ideas/scripts/captions, private asset library, generated media adapters, cost controls, and review UI.
- **Phase 3:** one official provider at a time; OAuth, capability checks, approval, scheduling, idempotent publishing, status reconciliation, and failure handling.
- **Phase 4:** comment monitoring/replies only where APIs and scopes permit; sensitivity triage and approval gates.
- **Phase 5:** analytics provenance, trend research, and recommendations based on real authorized metrics.
- **Phase 6:** visual workflow builder, multi-platform workflows, subscription/usage management, and production operations.

## Verification plan

Run Laravel unit and feature tests against MySQL, tenant-isolation tests, `php artisan route:list`, migration up/down checks on an empty disposable database, frontend typecheck/lint/build, queue idempotency tests with Redis, and secret/log redaction checks. Do not claim Phase 1 is running or verified until these checks pass in the required runtime. No code has been changed as part of this architecture baseline.

# Architecture

## Current shape

```text
Browser (same origin)
  ├─ static accessible HTML/CSS/JavaScript
  └─ JSON API ── Node.js HTTP server
                    ├─ session and workspace authorization
                    ├─ validation and rate limits
                    └─ SQLite repository + SQL migrations (local development)
```

The app uses Node.js built-in modules to keep the initial dependency surface small. TypeScript is used for the server and tests. The browser client is plain JavaScript and calls only same-origin endpoints.

## Tenant data flow

Registration creates a user, a personal workspace, an owner membership, a hashed session record, and an audit event in one database transaction. A session cookie carries a random opaque token; the database stores only its SHA-256 hash. Each authenticated request resolves the user and workspace from the server-side session. Draft reads and writes use that workspace ID in the SQL predicate; clients cannot choose a workspace ID.

## Data boundaries

- `users`: normalized unique email and password hash/salt.
- `workspaces`: tenant boundary.
- `memberships`: role assignment between users and workspaces.
- `sessions`: hashed opaque token, user/workspace pair, expiry.
- `drafts`: content owned by a workspace.
- `audit_events`: account and draft lifecycle event metadata; no secrets or draft body.
- `schema_migrations`: applied SQL migration versions.

## Scaling path

The current SQLite driver is intended only for local development and single-instance evaluation. Before a public multi-user deployment, replace the persistence adapter with PostgreSQL, use a shared session store and rate limiter, and add background workers for long-running tasks. Provider-specific features should depend on capability adapters, not on UI assumptions.

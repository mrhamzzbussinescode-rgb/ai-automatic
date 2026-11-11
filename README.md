# Social Workspace

A secure-first starting point for a multi-user social media management SaaS. The first working slice provides account registration and sign-in, a private personal workspace, and persistent content drafts.

## Current capabilities

- Create an account, sign in, and sign out.
- Every account receives a separate workspace and owner membership.
- Create, edit, list, and delete content drafts inside the active workspace.
- Review a paginated draft list and a real workspace draft count.
- Passwords are stored as salted scrypt hashes; session tokens are random, stored hashed, and sent only in HttpOnly cookies.
- Audit events record account and draft lifecycle actions without recording passwords, session tokens, or draft text.

Social account connections, publishing, AI generation, analytics, team invitations, organizations, and production deployment are not implemented. The interface does not simulate them.

## Run locally

Requirements: Node.js 26.11 or newer and npm.

```powershell
npm install
npm run typecheck
npm test
npm start
```

Open `http://localhost:3000`. The app binds to localhost by default. Set `PORT` to change the port, `HOST` to change the bind address, `DATABASE_PATH` to change the local SQLite file, and `APP_ORIGIN` to set the exact trusted browser origin. In production mode, `APP_ORIGIN` is required and secure cookies are enabled.

The local database is created under `data/social-workspace.sqlite`. Do not add this file to source control or put real customer data in a local development instance.

## Project documents

- [Product and milestone scope](PRODUCT.md)
- [Architecture and data flow](ARCHITECTURE.md)
- [Security controls and limitations](SECURITY.md)
- [Phase 1 source analysis](PHASE-1-ANALYSIS.md)

## Before any public deployment

Move persistence to a managed PostgreSQL service, use a shared session/rate-limit store, configure a managed secrets service and HTTPS termination, add verified email and account recovery, and complete the deployment/security review described in `SECURITY.md`. This project is a local development foundation, not a production-ready SaaS deployment.

# Repository instructions

Read [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [SECURITY.md](SECURITY.md) before changing application behavior.

- Keep provider integrations on official APIs and request the minimum required scopes.
- Scope every tenant-owned query by the authenticated workspace on the server.
- Never commit tokens, passwords, local databases, or real user content.
- Do not invent analytics, account connections, publishing outcomes, or AI results.
- Run `npm test` and `npm run typecheck` after code changes; report any check that could not run.
- Treat the current SQLite-backed app as local development only. Do not deploy it as a multi-instance SaaS service.

# Security status

## Implemented in this local foundation

- Passwords use Node's scrypt with a random salt and constant-time hash comparison.
- Session tokens are random, opaque, hashed in the database, expire after 12 hours, and are revoked on sign-out.
- Cookies are HttpOnly and SameSite=Strict; production cookies also use Secure and the `__Host-` prefix.
- Mutating API requests require an exact same-origin `Origin` and reject cross-site Fetch Metadata.
- The API validates JSON content type and limits request bodies, fields, platform values, and authentication attempts.
- Database operations use prepared statements, foreign keys, transactions for registration and audit-sensitive writes, and workspace-scoped predicates.
- Security headers include a restrictive Content Security Policy, frame protections, no-sniff, and a restrictive permissions policy.
- Errors returned to clients do not include stack traces or sensitive data. Logs contain only method, path, and a generic error marker.

## Known limitations

- This app is not production-ready. Node's built-in SQLite module is still a release-candidate API, and a local SQLite file does not support horizontally scaled SaaS instances. Use PostgreSQL before production.
- The login/register rate limiter is in memory and per process. A production deployment needs a shared limiter and abuse monitoring.
- Email verification, password reset, MFA, account recovery, security notifications, managed secrets, backups, monitoring, and deployment controls are not implemented.
- `APP_ORIGIN` must be configured to the exact HTTPS origin in production. A trusted reverse proxy and HTTPS termination still need deployment-specific review.
- No third-party OAuth token storage exists yet. When added, tokens must be encrypted server-side, scopes minimized, and revocation handled.

Do not place real customer data in this local instance or expose it to the public internet.

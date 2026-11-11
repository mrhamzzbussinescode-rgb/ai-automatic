# Product brief

## Goal

Build a responsive web SaaS for creators and organizations to manage social content safely, use authorized social APIs, and make decisions from real analytics.

## First release slice

The first slice establishes account and workspace isolation, secure sessions, and a real content-draft lifecycle. A user can register, sign in, create/edit/delete their own workspace drafts, and sign out. There are no demo accounts or fabricated social metrics.

## Acceptance criteria

- A new user gets a private workspace and owner membership.
- Draft API operations require a valid session and always include the authenticated workspace in database queries.
- A second user cannot list, update, or delete another user's draft, even when they know its ID.
- Passwords and session tokens are never returned to the browser or written to logs.
- The app clearly labels social publishing, integrations, AI, and analytics as not yet available.
- Tests cover registration, cookie/session behavior, draft CRUD, logout, CSRF origin checks, and cross-workspace isolation.

## Assumptions

- The first client is a responsive web application.
- The initial local persistence layer is for development and single-instance evaluation only.
- Platform API permissions and limitations will be verified against current official provider documentation when a provider is selected.

## Non-goals for this slice

- Social OAuth or publishing.
- AI-generated content or recommendations.
- Analytics dashboards or sample metrics.
- Team invitations, workspace switching, billing, or mobile/desktop clients.
- Public production deployment.

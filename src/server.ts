import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db.ts";
import {
  clearSessionCookie,
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  readCookie,
  SESSION_TTL_SECONDS,
  sessionCookie,
  verifyPassword,
} from "./security.ts";

const MAX_BODY_BYTES = 16 * 1024;
const DRAFT_PAGE_SIZE = 20;
const MAX_DRAFT_PAGE = 10_000;
const PLATFORMS = new Set(["general", "instagram", "tiktok", "youtube", "facebook", "linkedin", "x", "threads"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AppOptions {
  databasePath?: string;
  appOrigin?: string;
  production?: boolean;
}

interface SessionRow {
  user_id: string;
  display_name: string;
  email: string;
  workspace_id: string;
  workspace_name: string;
  role: string;
}

interface AuthContext extends SessionRow {}
type Database = DatabaseSync;

interface DraftInput {
  title: string;
  body: string;
  platform: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") fail(415, "Send this request as JSON.");

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    fail(413, "This request is too large.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) fail(413, "This request is too large.");
    chunks.push(buffer);
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      fail(400, "The request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "The request body is not valid JSON.");
  }
}

function addSecurityHeaders(response: ServerResponse, production: boolean): void {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
  ];
  if (production) directives.push("upgrade-insecure-requests");

  response.setHeader("Content-Security-Policy", directives.join("; "));
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (production) response.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function makeOriginGuard(configuredOrigin: string | undefined, production: boolean) {
  const normalizedConfiguredOrigin = configuredOrigin ? new URL(configuredOrigin).origin : undefined;

  return (request: IncomingMessage): void => {
    const origin = request.headers.origin;
    const fetchSite = request.headers["sec-fetch-site"];
    if (fetchSite === "cross-site" || typeof origin !== "string") {
      fail(403, "The request origin could not be verified.");
    }

    let requestOrigin: string;
    try {
      requestOrigin = new URL(origin).origin;
    } catch {
      fail(403, "The request origin could not be verified.");
    }

    const expectedOrigin = normalizedConfiguredOrigin
      ?? `${production ? "https" : "http"}://${request.headers.host ?? ""}`;
    if (!expectedOrigin || requestOrigin !== expectedOrigin) {
      fail(403, "The request origin could not be verified.");
    }
  };
}

function makeRateLimiter() {
  const entries = new Map<string, RateLimitEntry>();

  return (request: IncomingMessage, bucket: string, limit: number, windowMs: number): void => {
    const key = `${bucket}:${request.socket.remoteAddress ?? "unknown"}`;
    const now = Date.now();
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }

    entry.count += 1;
    if (entry.count > limit) fail(429, "Too many attempts. Please wait and try again.");

    if (entries.size > 1000) {
      for (const [entryKey, value] of entries) {
        if (value.resetAt <= now) entries.delete(entryKey);
      }
    }
  };
}

function getClientSession(
  database: Database,
  request: IncomingMessage,
  secureCookies: boolean,
): AuthContext | null {
  const cookieName = secureCookies ? "__Host-social_session" : "social_session";
  const token = readCookie(request.headers.cookie, cookieName);
  if (!token || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;

  const tokenHash = hashOpaqueToken(token);
  const row = database.prepare(`
    SELECT u.id AS user_id, u.display_name, u.email,
           w.id AS workspace_id, w.name AS workspace_name, m.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN workspaces w ON w.id = s.workspace_id
    JOIN memberships m ON m.user_id = s.user_id AND m.workspace_id = s.workspace_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, Date.now()) as SessionRow | undefined;

  if (!row) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ? AND expires_at <= ?")
      .run(tokenHash, Date.now());
    return null;
  }
  return row;
}

function createSession(database: Database, userId: string, workspaceId: string): string {
  const token = createOpaqueToken();
  const now = Date.now();
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  database.prepare(`
    INSERT INTO sessions(token_hash, user_id, workspace_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(hashOpaqueToken(token), userId, workspaceId, new Date(now).toISOString(), now + SESSION_TTL_SECONDS * 1000);
  return token;
}

function audit(
  database: Database,
  workspaceId: string,
  actorUserId: string,
  action: string,
  targetId: string | null,
  details: Record<string, string>,
): void {
  database.prepare(`
    INSERT INTO audit_events(id, workspace_id, actor_user_id, action, target_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), workspaceId, actorUserId, action, targetId, JSON.stringify(details), new Date().toISOString());
}

function requireString(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") fail(400, `${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    fail(400, `${label} must be between ${min} and ${max} characters.`);
  }
  return normalized;
}

function requirePassword(value: unknown, min: number): string {
  if (typeof value !== "string" || value.length < min || value.length > 128) {
    fail(400, `Password must be between ${min} and 128 characters.`);
  }
  return value;
}

function parseDraftInput(body: Record<string, unknown>, partial: boolean): Partial<DraftInput> {
  const input: Partial<DraftInput> = {};
  if (!partial || Object.hasOwn(body, "title")) input.title = requireString(body.title, "Title", 1, 120);
  if (!partial || Object.hasOwn(body, "body")) input.body = requireString(body.body, "Draft text", 1, 5000);
  if (!partial || Object.hasOwn(body, "platform")) {
    const platform = requireString(body.platform, "Platform", 1, 24).toLowerCase();
    if (!PLATFORMS.has(platform)) fail(400, "Choose a supported platform.");
    input.platform = platform;
  }
  if (partial && Object.keys(input).length === 0) fail(400, "Change at least one draft field.");
  return input;
}

function safeUser(context: AuthContext) {
  return {
    user: { id: context.user_id, name: context.display_name, email: context.email },
    workspace: { id: context.workspace_id, name: context.workspace_name, role: context.role },
  };
}

function mapDraft(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    platform: String(row.platform),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const publicFiles = new Map([
  ["/", { body: readFileSync(new URL("../public/index.html", import.meta.url)), type: "text/html; charset=utf-8", cache: "no-cache" }],
  ["/app.js", { body: readFileSync(new URL("../public/app.js", import.meta.url)), type: "text/javascript; charset=utf-8", cache: "public, max-age=3600" }],
  ["/styles.css", { body: readFileSync(new URL("../public/styles.css", import.meta.url)), type: "text/css; charset=utf-8", cache: "public, max-age=3600" }],
]);

function sendFile(response: ServerResponse, path: string): boolean {
  const file = publicFiles.get(path);
  if (!file) return false;
  response.writeHead(200, {
    "Content-Type": file.type,
    "Cache-Control": file.cache,
  });
  response.end(file.body);
  return true;
}

export function createApp(options: AppOptions = {}): { server: Server; close: () => void } {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const configuredOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  if (production && !configuredOrigin) throw new Error("APP_ORIGIN must be configured in production.");

  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? resolve("data/social-workspace.sqlite");
  const database = openDatabase(databasePath);
  const rateLimit = makeRateLimiter();
  const assertSameOrigin = makeOriginGuard(configuredOrigin, production);

  const server = createServer(async (request, response) => {
    addSecurityHeaders(response, production);
    const method = request.method ?? "GET";
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://local.invalid");
    } catch {
      json(response, 400, { error: "Invalid request URL." });
      return;
    }

    try {
      if (method === "GET" && url.pathname === "/health") {
        database.prepare("SELECT 1").get();
        json(response, 200, { status: "ok" });
        return;
      }

      if (method === "POST" || method === "PATCH" || method === "DELETE") {
        assertSameOrigin(request);
      }

      if (url.pathname.startsWith("/api/")) {
        rateLimit(request, "api", 120, 60 * 1000);
      }

      if (method === "POST" && url.pathname === "/api/auth/register") {
        rateLimit(request, "register", 10, 15 * 60 * 1000);
        const body = await readJson(request);
        const name = requireString(body.name, "Name", 2, 60);
        const email = requireString(body.email, "Email", 3, 254).toLowerCase();
        const password = requirePassword(body.password, 12);
        if (!EMAIL_PATTERN.test(email)) fail(400, "Enter a valid email address.");

        const userId = randomUUID();
        const workspaceId = randomUUID();
        const now = new Date().toISOString();
        const passwordRecord = await hashPassword(password);
        database.exec("BEGIN IMMEDIATE");
        try {
          database.prepare(`
            INSERT INTO users(id, display_name, email, password_salt, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(userId, name, email, passwordRecord.salt, passwordRecord.hash, now);
          database.prepare("INSERT INTO workspaces(id, name, created_at) VALUES (?, ?, ?)")
            .run(workspaceId, "Personal workspace", now);
          database.prepare(`
            INSERT INTO memberships(user_id, workspace_id, role, created_at)
            VALUES (?, ?, 'owner', ?)
          `).run(userId, workspaceId, now);
          const token = createSession(database, userId, workspaceId);
          audit(database, workspaceId, userId, "account.registered", userId, {});
          database.exec("COMMIT");
          response.setHeader("Set-Cookie", sessionCookie(token, production));
          json(response, 201, {
            user: { id: userId, name, email },
            workspace: { id: workspaceId, name: "Personal workspace", role: "owner" },
          });
        } catch (error) {
          database.exec("ROLLBACK");
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email")) {
            fail(409, "An account with this email already exists.");
          }
          throw error;
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/auth/login") {
        rateLimit(request, "login", 8, 15 * 60 * 1000);
        const body = await readJson(request);
        const email = requireString(body.email, "Email", 3, 254).toLowerCase();
        const password = requirePassword(body.password, 1);
        if (!EMAIL_PATTERN.test(email)) fail(400, "Enter a valid email address.");

        const user = database.prepare(`
          SELECT id, display_name, email, password_salt, password_hash
          FROM users WHERE email = ?
        `).get(email) as {
          id: string;
          display_name: string;
          email: string;
          password_salt: string;
          password_hash: string;
        } | undefined;

        const passwordMatches = await verifyPassword(password, user?.password_salt ?? "", user?.password_hash ?? "");
        if (!user || !passwordMatches) fail(401, "Email or password is incorrect.");

        const membership = database.prepare(`
          SELECT w.id AS workspace_id, w.name AS workspace_name, m.role
          FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.user_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, w.created_at LIMIT 1
        `).get(user.id) as { workspace_id: string; workspace_name: string; role: string } | undefined;
        if (!membership) fail(403, "This account has no active workspace.");

        database.exec("BEGIN IMMEDIATE");
        let token: string;
        try {
          token = createSession(database, user.id, membership.workspace_id);
          audit(database, membership.workspace_id, user.id, "account.signed_in", user.id, {});
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        response.setHeader("Set-Cookie", sessionCookie(token, production));
        json(response, 200, {
          user: { id: user.id, name: user.display_name, email: user.email },
          workspace: { id: membership.workspace_id, name: membership.workspace_name, role: membership.role },
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/auth/logout") {
        const context = getClientSession(database, request, production);
        if (context) {
          const token = readCookie(request.headers.cookie, production ? "__Host-social_session" : "social_session");
          database.exec("BEGIN IMMEDIATE");
          try {
            if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashOpaqueToken(token));
            audit(database, context.workspace_id, context.user_id, "account.signed_out", context.user_id, {});
            database.exec("COMMIT");
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
        }
        response.setHeader("Set-Cookie", clearSessionCookie(production));
        json(response, 200, { status: "signed_out" });
        return;
      }

      if (method === "GET" && url.pathname === "/api/auth/session") {
        const context = getClientSession(database, request, production);
        if (!context) {
          json(response, 401, { error: "Sign in to continue." });
          return;
        }
        json(response, 200, safeUser(context));
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const context = getClientSession(database, request, production);
        if (!context) {
          json(response, 401, { error: "Sign in to continue." });
          return;
        }

        if (method === "GET" && url.pathname === "/api/overview") {
          const totals = database.prepare(`
            SELECT COUNT(*) AS draft_count, MAX(updated_at) AS last_updated
            FROM drafts WHERE workspace_id = ?
          `).get(context.workspace_id) as { draft_count: number | bigint; last_updated: string | null };
          json(response, 200, {
            draftCount: Number(totals.draft_count),
            lastUpdated: totals.last_updated,
            integrations: "not_available",
            analytics: "not_available",
          });
          return;
        }

        if (method === "GET" && url.pathname === "/api/drafts") {
          const pageValue = Number(url.searchParams.get("page") ?? "1");
          const page = Number.isSafeInteger(pageValue) && pageValue >= 1 && pageValue <= MAX_DRAFT_PAGE ? pageValue : 1;
          const offset = (page - 1) * DRAFT_PAGE_SIZE;
          const count = database.prepare("SELECT COUNT(*) AS total FROM drafts WHERE workspace_id = ?")
            .get(context.workspace_id) as { total: number | bigint };
          const rows = database.prepare(`
            SELECT id, title, body, platform, created_at, updated_at
            FROM drafts WHERE workspace_id = ?
            ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?
          `).all(context.workspace_id, DRAFT_PAGE_SIZE, offset) as Record<string, unknown>[];
          json(response, 200, {
            items: rows.map(mapDraft),
            page,
            pageSize: DRAFT_PAGE_SIZE,
            total: Number(count.total),
          });
          return;
        }

        if (method === "POST" && url.pathname === "/api/drafts") {
          const body = await readJson(request);
          const draft = parseDraftInput(body, false) as DraftInput;
          const id = randomUUID();
          const now = new Date().toISOString();
          database.exec("BEGIN IMMEDIATE");
          try {
            database.prepare(`
              INSERT INTO drafts(id, workspace_id, created_by, title, body, platform, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, context.workspace_id, context.user_id, draft.title, draft.body, draft.platform, now, now);
            audit(database, context.workspace_id, context.user_id, "draft.created", id, { platform: draft.platform });
            database.exec("COMMIT");
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
          json(response, 201, { id, ...draft, createdAt: now, updatedAt: now });
          return;
        }

        const draftRoute = url.pathname.match(/^\/api\/drafts\/([^/]+)$/);
        if (draftRoute && (method === "PATCH" || method === "DELETE")) {
          const draftId = draftRoute[1];
          if (!UUID_PATTERN.test(draftId)) fail(404, "Draft not found.");
          const existing = database.prepare(`
            SELECT id, platform FROM drafts WHERE id = ? AND workspace_id = ?
          `).get(draftId, context.workspace_id) as { id: string; platform: string } | undefined;
          if (!existing) fail(404, "Draft not found.");

          if (method === "PATCH") {
            const body = await readJson(request);
            const changes = parseDraftInput(body, true);
            const next = {
              title: changes.title ?? undefined,
              body: changes.body ?? undefined,
              platform: changes.platform ?? undefined,
              updatedAt: new Date().toISOString(),
            };
            const assignments: string[] = [];
            const values: string[] = [];
            for (const field of ["title", "body", "platform"] as const) {
              if (next[field] !== undefined) {
                assignments.push(`${field} = ?`);
                values.push(next[field]);
              }
            }
            assignments.push("updated_at = ?");
            values.push(next.updatedAt);
            values.push(draftId, context.workspace_id);

            database.exec("BEGIN IMMEDIATE");
            try {
              database.prepare(`UPDATE drafts SET ${assignments.join(", ")} WHERE id = ? AND workspace_id = ?`)
                .run(...values);
              audit(database, context.workspace_id, context.user_id, "draft.updated", draftId, {
                platform: changes.platform ?? existing.platform,
              });
              database.exec("COMMIT");
            } catch (error) {
              database.exec("ROLLBACK");
              throw error;
            }
            const updated = database.prepare(`
              SELECT id, title, body, platform, created_at, updated_at
              FROM drafts WHERE id = ? AND workspace_id = ?
            `).get(draftId, context.workspace_id) as Record<string, unknown>;
            json(response, 200, mapDraft(updated));
            return;
          }

          database.exec("BEGIN IMMEDIATE");
          try {
            database.prepare("DELETE FROM drafts WHERE id = ? AND workspace_id = ?")
              .run(draftId, context.workspace_id);
            audit(database, context.workspace_id, context.user_id, "draft.deleted", draftId, { platform: existing.platform });
            database.exec("COMMIT");
          } catch (error) {
            database.exec("ROLLBACK");
            throw error;
          }
          json(response, 200, { status: "deleted" });
          return;
        }

        json(response, 404, { error: "This endpoint does not exist." });
        return;
      }

      if (method === "GET" && sendFile(response, url.pathname)) return;
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Something went wrong. Please try again.";
      if (status >= 500) console.error("request_failed", { method });
      if (!response.headersSent) json(response, status, { error: message });
      else response.destroy();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  return { server, close: () => database.close() };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  app.server.listen(port, host, () => {
    console.log(`Social Workspace is listening at http://${host}:${port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => app.server.close(() => app.close()));
  }
}

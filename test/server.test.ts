import assert from "node:assert/strict";
import { test, type TestContext as NodeTestContext } from "node:test";
import { createApp } from "../src/server.ts";

interface TestAppContext {
  origin: string;
  cookieFrom(response: Response): string;
  call(path: string, options?: { method?: string; body?: unknown; cookie?: string; origin?: string }): Promise<Response>;
}

async function startTestApp(t: NodeTestContext): Promise<TestAppContext> {
  const app = createApp({ databasePath: ":memory:" });
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", () => {
      app.server.off("error", reject);
      resolve();
    });
  });

  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      app.server.close((error) => error ? reject(error) : resolve());
    });
    app.close();
  });

  return {
    origin,
    cookieFrom(response) {
      const value = response.headers.get("set-cookie");
      assert.ok(value, "expected a session cookie");
      return value.split(";", 1)[0];
    },
    async call(path, options = {}) {
      const method = options.method ?? "GET";
      const headers: Record<string, string> = {};
      if (["POST", "PATCH", "DELETE"].includes(method)) headers.Origin = options.origin ?? origin;
      if (options.cookie) headers.Cookie = options.cookie;
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      return fetch(`${origin}${path}`, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    },
  };
}

const firstPassword = "  Correct Horse Battery!  ";

test("registration, draft lifecycle, and logout use secure session behavior", async (t) => {
  const app = await startTestApp(t);
  const registration = await app.call("/api/auth/register", {
    method: "POST",
    body: { name: "Morgan Example", email: "Morgan@example.com", password: firstPassword },
  });
  assert.equal(registration.status, 201);
  const registrationBody = await registration.json();
  const cookie = app.cookieFrom(registration);
  const cookieAttributes = registration.headers.get("set-cookie") ?? "";
  assert.match(cookieAttributes, /HttpOnly/i);
  assert.match(cookieAttributes, /SameSite=Strict/i);
  assert.equal(registrationBody.workspace.role, "owner");
  assert.equal(JSON.stringify(registrationBody).includes(firstPassword), false);

  const session = await app.call("/api/auth/session", { cookie });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).workspace.id, registrationBody.workspace.id);

  const created = await app.call("/api/drafts", {
    method: "POST",
    cookie,
    body: { title: "Spring launch outline", body: "A short introduction for the new product.", platform: "instagram" },
  });
  assert.equal(created.status, 201);
  const draft = await created.json();
  assert.equal(draft.platform, "instagram");

  const list = await app.call("/api/drafts?page=1", { cookie });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items.length, 1);

  const updated = await app.call(`/api/drafts/${draft.id}`, {
    method: "PATCH",
    cookie,
    body: { title: "Spring launch story" },
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).title, "Spring launch story");

  const deleted = await app.call(`/api/drafts/${draft.id}`, { method: "DELETE", cookie });
  assert.equal(deleted.status, 200);
  assert.equal((await (await app.call("/api/drafts", { cookie })).json()).total, 0);

  const logout = await app.call("/api/auth/logout", { method: "POST", cookie, body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await app.call("/api/auth/session", { cookie })).status, 401);
});

test("draft operations cannot cross workspace boundaries, even with a known draft ID", async (t) => {
  const app = await startTestApp(t);
  const firstRegistration = await app.call("/api/auth/register", {
    method: "POST",
    body: { name: "First Creator", email: "first@example.com", password: firstPassword },
  });
  const firstCookie = app.cookieFrom(firstRegistration);
  const createResponse = await app.call("/api/drafts", {
    method: "POST",
    cookie: firstCookie,
    body: { title: "Private draft", body: "This belongs to the first workspace.", platform: "general" },
  });
  const privateDraft = await createResponse.json();

  const secondRegistration = await app.call("/api/auth/register", {
    method: "POST",
    body: { name: "Second Creator", email: "second@example.com", password: "Another secure phrase! 456" },
  });
  const secondCookie = app.cookieFrom(secondRegistration);

  const secondList = await app.call("/api/drafts", { cookie: secondCookie });
  assert.equal((await secondList.json()).total, 0);
  assert.equal((await app.call(`/api/drafts/${privateDraft.id}`, {
    method: "PATCH",
    cookie: secondCookie,
    body: { title: "Attempted access" },
  })).status, 404);
  assert.equal((await app.call(`/api/drafts/${privateDraft.id}`, {
    method: "DELETE",
    cookie: secondCookie,
  })).status, 404);

  const firstList = await app.call("/api/drafts", { cookie: firstCookie });
  assert.equal((await firstList.json()).items[0].title, "Private draft");
});

test("mutating requests reject missing or untrusted origins", async (t) => {
  const app = await startTestApp(t);
  const rejected = await app.call("/api/auth/register", {
    method: "POST",
    origin: "https://attacker.invalid",
    body: { name: "Blocked Person", email: "blocked@example.com", password: firstPassword },
  });
  assert.equal(rejected.status, 403);
  assert.deepEqual(await rejected.json(), { error: "The request origin could not be verified." });

  const noOrigin = await fetch(`${app.origin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Blocked Person", email: "blocked@example.com", password: firstPassword }),
  });
  assert.equal(noOrigin.status, 403);
});

test("login preserves exact passwords and errors do not reveal whether an email exists", async (t) => {
  const app = await startTestApp(t);
  await app.call("/api/auth/register", {
    method: "POST",
    body: { name: "Login Test", email: "login@example.com", password: firstPassword },
  });

  const success = await app.call("/api/auth/login", {
    method: "POST",
    body: { email: "LOGIN@example.com", password: firstPassword },
  });
  assert.equal(success.status, 200);
  assert.ok(success.headers.get("set-cookie"));

  const wrongPassword = await app.call("/api/auth/login", {
    method: "POST",
    body: { email: "login@example.com", password: "incorrect password" },
  });
  const missingEmail = await app.call("/api/auth/login", {
    method: "POST",
    body: { email: "absent@example.com", password: "incorrect password" },
  });
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongPassword.json(), await missingEmail.json());
});

test("browser responses carry restrictive security headers", async (t) => {
  const app = await startTestApp(t);
  const response = await app.call("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const [script, styles] = await Promise.all([app.call("/app.js"), app.call("/styles.css")]);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  assert.match(await script.text(), /function renderOverview/);
  assert.match(styles.headers.get("content-type") ?? "", /text\/css/);
  assert.match(await styles.text(), /prefers-reduced-motion/);
});

test("production mode requires an origin and marks the session cookie Secure", async (t) => {
  assert.throws(() => createApp({ databasePath: ":memory:", production: true }), /APP_ORIGIN/);

  const app = createApp({
    databasePath: ":memory:",
    production: true,
    appOrigin: "https://social.example.test",
  });
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", () => {
      app.server.off("error", reject);
      resolve();
    });
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      app.server.close((error) => error ? reject(error) : resolve());
    });
    app.close();
  });

  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/register`, {
    method: "POST",
    headers: {
      Origin: "https://social.example.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Production Test", email: "prod@example.com", password: firstPassword }),
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie") ?? "", /^__Host-social_session=/);
  assert.match(response.headers.get("set-cookie") ?? "", /; Secure/);
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
});

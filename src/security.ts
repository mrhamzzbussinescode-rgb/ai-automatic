import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = "d80c31e0f41499ba801282626aa10e44";
const DUMMY_HASH = deriveKey("dummy-password-for-timing", Buffer.from(DUMMY_SALT, "hex"));

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

export async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  const validRecord = /^[a-f0-9]{32}$/i.test(saltHex) && /^[a-f0-9]{128}$/i.test(hashHex);
  const salt = validRecord ? Buffer.from(saltHex, "hex") : Buffer.from(DUMMY_SALT, "hex");
  const expected = validRecord ? Buffer.from(hashHex, "hex") : await DUMMY_HASH;
  const actual = await deriveKey(password, salt);
  const matches = timingSafeEqual(actual, expected);
  return validRecord && matches;
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name === cookieName) return segment.slice(separator + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const name = secure ? "__Host-social_session" : "social_session";
  const secureAttribute = secure ? "; Secure" : "";
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secureAttribute}`;
}

export function clearSessionCookie(secure: boolean): string {
  const name = secure ? "__Host-social_session" : "social_session";
  const secureAttribute = secure ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute}`;
}

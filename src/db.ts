import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as sqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";

const migrationsDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));
const DatabaseConstructor = (sqlite as unknown as { Database: typeof DatabaseSync }).Database;

export function openDatabase(databasePath: string): DatabaseSync {
  const absolutePath = databasePath === ":memory:" ? ":memory:" : resolve(databasePath);
  if (absolutePath !== ":memory:") mkdirSync(dirname(absolutePath), { recursive: true });

  const database = new DatabaseConstructor(absolutePath, { timeout: 5000 });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => String(row.version)),
  );
  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  for (const version of migrations) {
    if (applied.has(version)) continue;

    const sql = readFileSync(resolve(migrationsDirectory, version), "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      database.close();
      throw error;
    }
  }

  return database;
}

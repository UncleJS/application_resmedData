#!/usr/bin/env bun
/**
 * add_user.ts — Seed a user into the resmed_sleep.users table.
 *
 * Run from the dashboard/ directory (where node_modules live):
 *
 *   cd /home/jacos/0_opencode/application_resmedData/dashboard
 *   bun ../scripts/add_user.ts --username admin --password s3cr3t
 *   bun ../scripts/add_user.ts --username admin --password s3cr3t --force
 *
 * Reads DB credentials from ../deploy/resmed.env (falls back to env vars).
 */

import { createConnection } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load ../deploy/resmed.env if env vars are not already set ────────────────
function loadEnvFile(path: string) {
  try {
    const text = readFileSync(path, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // file missing — rely on real env vars already in environment
  }
}

// When run from dashboard/, this resolves to deploy/resmed.env one level up
loadEnvFile(resolve(process.cwd(), "../deploy/resmed.env"));

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}
const username = flag("username");
const password = flag("password");
const force    = args.includes("--force");

if (!username || !password) {
  console.error(
    "Usage: bun ../scripts/add_user.ts --username <name> --password <pass> [--force]"
  );
  process.exit(1);
}

// ── Connect ───────────────────────────────────────────────────────────────────
const conn = await createConnection({
  host:     process.env.DB_HOST     ?? "192.168.10.51",
  port:     parseInt(process.env.DB_PORT ?? "3306"),
  user:     process.env.DB_USER     ?? "resmed",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME     ?? "resmed_sleep",
  timezone: "+00:00",
});

try {
  // Check for existing user
  const [rows] = await conn.query<any[]>(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username]
  );

  if (rows.length > 0) {
    if (!force) {
      console.error(
        `User "${username}" already exists. Use --force to update the password.`
      );
      process.exit(1);
    }
    // Update password
    const hash = await bcrypt.hash(password, 12);
    await conn.query(
      "UPDATE users SET password_hash = ? WHERE username = ?",
      [hash, username]
    );
    console.log(`✓ Password updated for user "${username}".`);
  } else {
    // Insert new user
    const hash = await bcrypt.hash(password, 12);
    await conn.query(
      "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, NOW())",
      [username, hash]
    );
    console.log(`✓ User "${username}" created successfully.`);
  }
} finally {
  await conn.end();
}

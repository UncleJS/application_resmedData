import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  is_admin: boolean;
  created_at_utc: string;
  archived_at_utc: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function normNullable(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function mapUser(r: RowDataPacket): UserRow {
  return {
    id:              r.id,
    username:        r.username as string,
    display_name:    r.display_name ? String(r.display_name) : null,
    is_admin:        Boolean(r.is_admin),
    created_at_utc:  normDate(r.created_at_utc),
    archived_at_utc: normNullable(r.archived_at_utc),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Return all users ordered by username (includes archived). */
export async function listUsers(): Promise<UserRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, username, display_name, is_admin, created_at_utc, archived_at_utc
       FROM users
      ORDER BY username ASC`
  );
  return rows.map(mapUser);
}

/** Find an active (non-archived) user by username. */
export async function findActiveUser(username: string): Promise<UserRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, username, display_name, is_admin, created_at_utc, archived_at_utc
       FROM users
      WHERE username = ? AND archived_at_utc IS NULL
      LIMIT 1`,
    [username]
  );
  return rows.length > 0 ? mapUser(rows[0]) : null;
}

/** Find any user (including archived) by username. */
export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, username, display_name, is_admin, created_at_utc, archived_at_utc
       FROM users
      WHERE username = ?
      LIMIT 1`,
    [username]
  );
  return rows.length > 0 ? mapUser(rows[0]) : null;
}

/** Insert a new user. Caller must supply the bcrypt hash. */
export async function insertUser(
  username: string,
  passwordHash: string,
  displayName: string | null,
  isAdmin: boolean
): Promise<void> {
  await pool.execute(
    `INSERT INTO users (username, password_hash, display_name, is_admin, created_at_utc)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
    [username, passwordHash, displayName ?? null, isAdmin ? 1 : 0]
  );
}

/** Update the password hash for a user by id. */
export async function updatePasswordHash(id: number, passwordHash: string): Promise<void> {
  await pool.execute(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    [passwordHash, id]
  );
}

/** Soft-delete: set archived_at_utc to now. */
export async function archiveUser(id: number): Promise<void> {
  await pool.execute(
    `UPDATE users SET archived_at_utc = UTC_TIMESTAMP() WHERE id = ?`,
    [id]
  );
}

/** Restore a soft-deleted user by clearing archived_at_utc. */
export async function restoreUser(id: number): Promise<void> {
  await pool.execute(
    `UPDATE users SET archived_at_utc = NULL WHERE id = ?`,
    [id]
  );
}

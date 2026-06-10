"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import {
  findUserByUsername,
  insertUser,
  updatePasswordHash,
  archiveUser,
  restoreUser,
  listUsers,
} from "@/lib/queries/users";

const ADMIN_PATH = "/dashboard/admin/users";

// ---------------------------------------------------------------------------
// Guard — all actions require an active admin session
// ---------------------------------------------------------------------------

async function requireAdmin(): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_admin) {
    throw new Error("Forbidden: admin access required");
  }
}

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------

export async function createUser(formData: FormData): Promise<void> {
  await requireAdmin();

  const username    = (formData.get("username")     as string | null)?.trim() ?? "";
  const password    = (formData.get("password")     as string | null) ?? "";
  const displayName = (formData.get("display_name") as string | null)?.trim() || null;
  const isAdmin     = formData.get("is_admin") === "1";

  if (!username || !password) throw new Error("Username and password are required.");
  if (username.length > 64)   throw new Error("Username must be 64 characters or fewer.");
  if (password.length < 8)    throw new Error("Password must be at least 8 characters.");

  const existing = await findUserByUsername(username);
  if (existing) throw new Error(`User "${username}" already exists (may be archived).`);

  const hash = await bcrypt.hash(password, 12);
  await insertUser(username, hash, displayName, isAdmin);
  revalidatePath(ADMIN_PATH);
}

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------

export async function changePassword(formData: FormData): Promise<void> {
  await requireAdmin();

  const idStr    = (formData.get("id")       as string | null) ?? "";
  const password = (formData.get("password") as string | null) ?? "";

  const id = parseInt(idStr, 10);
  if (!id || isNaN(id))    throw new Error("Invalid user id.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const hash = await bcrypt.hash(password, 12);
  await updatePasswordHash(id, hash);
  revalidatePath(ADMIN_PATH);
}

// ---------------------------------------------------------------------------
// Archive user
// ---------------------------------------------------------------------------

export async function archiveUserAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const session = await getServerSession(authOptions);
  const idStr = (formData.get("id") as string | null) ?? "";
  const id = parseInt(idStr, 10);
  if (!id || isNaN(id)) throw new Error("Invalid user id.");

  // Prevent self-archive
  const users = await listUsers();
  const target = users.find((u) => u.id === id);
  if (!target) throw new Error("User not found.");
  if (target.username === session?.user?.email) {
    throw new Error("You cannot archive your own account.");
  }

  // Prevent locking everyone out: the last active admin cannot be archived
  if (target.is_admin && !target.archived_at_utc) {
    const activeAdmins = users.filter((u) => u.is_admin && !u.archived_at_utc);
    if (activeAdmins.length <= 1) {
      throw new Error("Cannot archive the last active admin account.");
    }
  }

  await archiveUser(id);
  revalidatePath(ADMIN_PATH);
}

// ---------------------------------------------------------------------------
// Restore user
// ---------------------------------------------------------------------------

export async function restoreUserAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const idStr = (formData.get("id") as string | null) ?? "";
  const id = parseInt(idStr, 10);
  if (!id || isNaN(id)) throw new Error("Invalid user id.");

  await restoreUser(id);
  revalidatePath(ADMIN_PATH);
}

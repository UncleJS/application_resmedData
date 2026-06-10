import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

// Hashed once per server start; compared against when the username does not
// exist so unknown and known usernames take the same bcrypt time (prevents
// user enumeration via response timing).
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", 12);

// In-memory login throttle: after MAX_FAILURES failed attempts a username is
// locked for WINDOW_MS. Per-process state — sufficient for this single-node app.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function isLockedOut(key: string): boolean {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    loginFailures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const throttleKey = credentials.username.trim().toLowerCase();
        if (isLockedOut(throttleKey)) return null;
        const [rows] = await pool.execute<RowDataPacket[]>(
          "SELECT id, username, password_hash, display_name, is_admin FROM users WHERE username = ? AND archived_at_utc IS NULL LIMIT 1",
          [credentials.username]
        );
        const user = rows[0];
        const ok = await bcrypt.compare(
          credentials.password,
          user ? (user.password_hash as string) : DUMMY_HASH
        );
        if (!user || !ok) {
          recordFailure(throttleKey);
          return null;
        }
        loginFailures.delete(throttleKey);
        return {
          id: String(user.id),
          name: user.display_name ?? user.username,
          email: user.username,
          is_admin: Boolean(user.is_admin),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.is_admin = user.is_admin ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.is_admin = token.is_admin as boolean;
      }
      return session;
    },
  },
};

export default NextAuth(authOptions);

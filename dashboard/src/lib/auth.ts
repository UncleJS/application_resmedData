import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

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
        const [rows] = await pool.execute<RowDataPacket[]>(
          "SELECT id, username, password_hash, display_name FROM users WHERE username = ? AND archived_at_utc IS NULL LIMIT 1",
          [credentials.username]
        );
        const user = rows[0];
        if (!user) return null;
        const ok = await bcrypt.compare(credentials.password, user.password_hash as string);
        if (!ok) return null;
        return { id: String(user.id), name: user.display_name ?? user.username, email: user.username };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) session.user.name = session.user.name;
      return session;
    },
  },
};

export default NextAuth(authOptions);

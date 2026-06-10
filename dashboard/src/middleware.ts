export { default } from "next-auth/middleware";

export const config = {
  // Cover the dashboard and every /api route except NextAuth's own endpoints,
  // so future API routes are protected by default (routes still do their own
  // getServerSession checks as a second layer).
  matcher: ["/dashboard/:path*", "/api/((?!auth).*)"],
};

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      id?: string;
      is_admin?: boolean;
    };
  }

  interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    is_admin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    is_admin?: boolean;
  }
}

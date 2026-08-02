import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const hasDatabase = Boolean(process.env.DATABASE_URL);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Falls back to a fixed dev-only secret so the storefront runs with zero
  // setup (`npm run dev`, no .env). Production deploys must set AUTH_SECRET
  // — see README "Environment Variables".
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "dev-only-insecure-secret-do-not-use-in-production"),
  // The Prisma adapter requires a live database. In local dev without
  // DATABASE_URL, sessions still work (JWT strategy) but persistence of
  // accounts/orders requires a configured DB — see README "Environment
  // Variables".
  adapter: hasDatabase ? PrismaAdapter(db) : undefined,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/account/login",
    newUser: "/account",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!hasDatabase) {
          throw new Error(
            "Accounts require DATABASE_URL to be configured. See README.md."
          );
        }
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "CUSTOMER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});

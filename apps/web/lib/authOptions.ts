import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { upsertUserByEmail } from "./ensureUser";

function allowedEmailSet(): Set<string> {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase()?.trim();
      if (!email) return false;
      const allowed = allowedEmailSet();
      if (allowed.size === 0) return false;
      return allowed.has(email);
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === "google" && profile?.email) {
        const email = String(profile.email).toLowerCase().trim();
        const name = profile.name != null ? String(profile.name) : null;
        const id = await upsertUserByEmail(email, name);
        return { ...token, sub: id };
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};

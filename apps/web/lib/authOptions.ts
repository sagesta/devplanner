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

const cookieDomain = process.env.NEXTAUTH_COOKIE_DOMAIN?.trim();

/** When the API is on another subdomain, share the session cookie across your root domain (HTTPS). */
const crossSubdomainCookies =
  cookieDomain != null && cookieDomain.length > 0
    ? {
        cookies: {
          sessionToken: {
            name:
              process.env.NODE_ENV === "production"
                ? "__Secure-next-auth.session-token"
                : "next-auth.session-token",
            options: {
              httpOnly: true,
              sameSite: "none" as const,
              path: "/",
              secure: true,
              domain: cookieDomain,
            },
          },
        },
      }
    : {};

export const authOptions: NextAuthOptions = {
  ...crossSubdomainCookies,
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

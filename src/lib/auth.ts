import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "@/db";

/**
 * Authentication.
 *
 * Better Auth rather than Auth.js: Auth.js was handed to the Better Auth team
 * in September 2025 and its v5 is still beta years on, with its own maintainers
 * recommending Better Auth for new projects. Sessions live in our database,
 * which also gives immediate revocation.
 *
 * Email and password only. There is no third-party provider to connect —
 * rides arrive as files — so an OAuth dependency would buy nothing.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // No mail provider is wired up yet, so requiring verification would lock
    // every new account out. Revisit before this is public.
    requireEmailVerification: false,
    minPasswordLength: 10,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    // Accounts are invite-scale, so cookies can be strict.
    defaultCookieAttributes: { sameSite: "lax", secure: process.env.NODE_ENV === "production" },
  },
});

export type Session = typeof auth.$Infer.Session;

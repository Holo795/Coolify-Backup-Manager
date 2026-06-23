import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { prisma } from "./prisma";
import { env } from "./env";

const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
if (env.oauth.githubClientId && env.oauth.githubClientSecret) {
  socialProviders.github = {
    clientId: env.oauth.githubClientId,
    clientSecret: env.oauth.githubClientSecret,
  };
}
if (env.oauth.googleClientId && env.oauth.googleClientSecret) {
  socialProviders.google = {
    clientId: env.oauth.googleClientId,
    clientSecret: env.oauth.googleClientSecret,
  };
}
if (env.oauth.gitlabClientId && env.oauth.gitlabClientSecret) {
  socialProviders.gitlab = {
    clientId: env.oauth.gitlabClientId,
    clientSecret: env.oauth.gitlabClientSecret,
  };
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.authSecret,
  baseURL: env.authUrl,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
  },
  socialProviders,
  trustedOrigins: [env.authUrl, "http://localhost:3000"],
  databaseHooks: {
    user: {
      create: {
        // The first person to register becomes the admin; registration is then
        // closed. Blocks every sign-up path (email + social) once a user exists.
        before: async (user) => {
          const count = await prisma.user.count();
          if (count > 0) {
            throw new APIError("FORBIDDEN", {
              message: "Registration is closed — an account already exists.",
            });
          }
          return { data: user };
        },
      },
    },
  },
});

export type Auth = typeof auth;

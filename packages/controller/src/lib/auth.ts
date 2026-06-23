import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
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
});

export type Auth = typeof auth;

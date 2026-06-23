// Runs once at server startup (Node runtime). Seeds the first admin and starts
// the in-process backup scheduler.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { prisma } = await import("@/lib/prisma");
    const { env } = await import("@/lib/env");
    const { auth } = await import("@/lib/auth");

    if (env.seedAdminEmail && env.seedAdminPassword) {
      const count = await prisma.user.count();
      if (count === 0) {
        await auth.api
          .signUpEmail({
            body: {
              email: env.seedAdminEmail,
              password: env.seedAdminPassword,
              name: "Admin",
            },
          })
          .then(() => console.log(`[seed] admin ${env.seedAdminEmail} created`))
          .catch((e: unknown) => console.error("[seed] admin failed", e));
      }
    }
  } catch (e) {
    console.error("[instrumentation] seed failed", e);
  }

  try {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  } catch (e) {
    console.error("[instrumentation] scheduler failed", e);
  }
}

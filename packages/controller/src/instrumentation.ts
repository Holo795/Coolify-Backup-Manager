// Runs once at server startup (Node runtime). Starts the in-process backup
// scheduler. There is no admin seed: the first person to register becomes the
// admin and registration then closes (see lib/auth.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  } catch (e) {
    console.error("[instrumentation] scheduler failed", e);
  }
}

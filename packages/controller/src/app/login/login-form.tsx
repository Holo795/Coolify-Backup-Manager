"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { DatabaseBackup, Github } from "lucide-react";

/**
 * needsSetup = there are no users yet, so this first registration creates the
 * admin. Once an account exists, registration is closed (enforced server-side
 * in lib/auth.ts) and we only show the sign-in form.
 */
export function LoginForm({ needsSetup, hasGithub }: { needsSetup: boolean; hasGithub: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await (needsSetup
        ? authClient.signUp.email({ email, password, name: email.split("@")[0] })
        : authClient.signIn.email({ email, password }));
      if (res.error) setError(res.error.message ?? "Authentication failed");
      else router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <DatabaseBackup className="h-6 w-6" />
          </div>
          <CardTitle>CBM — Coolify Backup Manager</CardTitle>
          <p className="text-sm text-muted-foreground">
            {needsSetup ? "Create the admin account — this first account is the administrator." : "Sign in to continue"}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? "…" : needsSetup ? "Create admin account" : "Sign in"}
            </Button>
          </form>

          {hasGithub && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
              </div>
              <Button type="button" variant="outline" onClick={() => authClient.signIn.social({ provider: "github" })}>
                <Github className="h-4 w-4" /> Continue with GitHub
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

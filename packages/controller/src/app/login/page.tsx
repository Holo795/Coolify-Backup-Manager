"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { DatabaseBackup, Github } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const fn =
        mode === "signin"
          ? authClient.signIn.email({ email, password })
          : authClient.signUp.email({ email, password, name: email.split("@")[0] });
      const res = await fn;
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
          <CardTitle>Coolify Backup Manager</CardTitle>
          <p className="text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to continue" : "Create your admin account"}
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
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
            </Button>
          </form>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" onClick={() => authClient.signIn.social({ provider: "github" })}>
              <Github className="h-4 w-4" /> Continue with GitHub
            </Button>
          </div>

          <button
            type="button"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

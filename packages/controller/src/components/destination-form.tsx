"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Select } from "./ui";
import { createDestination } from "@/app/actions";

export function DestinationForm() {
  const [type, setType] = useState("local");
  const [engine, setEngine] = useState("tar");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const formEl = e.currentTarget;
        setError(null);
        start(async () => {
          const r = await createDestination(fd);
          if (r?.error) setError(r.error);
          else formEl.reset();
        });
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" placeholder="offsite-backups" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Type</Label>
        <Select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="local">Local folder</option>
          <option value="ssh">SSH / SFTP</option>
          <option value="s3">S3 compatible</option>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="engine">Storage engine</Label>
        <Select id="engine" name="engine" value={engine} onChange={(e) => setEngine(e.target.value)}>
          <option value="tar">Standard (one archive per backup)</option>
          <option value="restic">restic - incremental + deduplicated + encrypted</option>
        </Select>
        {engine === "restic" && (
          <p className="text-xs text-muted-foreground">
            Only changed data is uploaded each run; the repository is encrypted and handles retention. Restore is
            supported in place and to a new resource.
          </p>
        )}
      </div>

      {type === "local" && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          Stored directly on the <b className="text-foreground">agent host</b> at{" "}
          <span className="font-mono text-foreground">/backups</span> (bind-mounted by the install command), so you can{" "}
          <span className="font-mono">ls /backups</span> on the host and it survives agent restarts. Nothing to configure.
        </div>
      )}

      {type === "ssh" && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field name="host" label="Host" placeholder="backup.example.com" />
            <Field name="port" label="Port" placeholder="22" defaultValue="22" />
          </div>
          <Field name="username" label="Username" placeholder="backups" />
          <Field name="basePath" label="Base path" placeholder="/srv/backups" />
          <Field name="password" label="Password (or leave blank for key)" type="password" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="privateKey">Private key (PEM, optional)</Label>
            <textarea
              id="privateKey"
              name="privateKey"
              rows={3}
              className="rounded-md border bg-transparent px-3 py-2 font-mono text-xs"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </div>

          {/* Optional bastion / jump host for targets that aren't reachable
              directly (e.g. a private IP behind a gateway). */}
          <details className="rounded-md border bg-muted/20 p-3">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              Connect through a jump host (bastion) - optional
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                The agent first connects to the jump host, then tunnels to the target above. The <b>agent&apos;s host</b>{" "}
                must be able to reach the jump host. Leave blank for a direct connection.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field name="jumpHost" label="Jump host" placeholder="bastion.example.com" />
                <Field name="jumpPort" label="Jump port" placeholder="22" defaultValue="22" />
              </div>
              <Field name="jumpUsername" label="Jump username" placeholder="backups" />
              <Field name="jumpPassword" label="Jump password (or leave blank for key)" type="password" />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jumpPrivateKey">Jump private key (PEM, optional)</Label>
                <textarea
                  id="jumpPrivateKey"
                  name="jumpPrivateKey"
                  rows={3}
                  className="rounded-md border bg-transparent px-3 py-2 font-mono text-xs"
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY----- (blank = reuse the key above)"
                />
              </div>
            </div>
          </details>
        </>
      )}

      {type === "s3" && (
        <>
          <Field name="bucket" label="Bucket" placeholder="coolify-backups" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field name="region" label="Region" placeholder="us-east-1" defaultValue="us-east-1" />
            <Field name="prefix" label="Prefix" placeholder="cbm" />
          </div>
          <Field name="endpoint" label="Endpoint (MinIO etc., optional)" placeholder="https://minio.example.com" />
          <Field name="accessKeyId" label="Access key ID" />
          <Field name="secretAccessKey" label="Secret access key" type="password" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="forcePathStyle" /> Force path-style (MinIO)
          </label>
        </>
      )}

      {engine === "tar" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="encryptionEnabled" /> Encrypt artifacts at rest (AES-256-GCM)
        </label>
      )}

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? "Working…" : "Add destination"}
      </Button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
  defaultValue,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} placeholder={placeholder} type={type} defaultValue={defaultValue} />
    </div>
  );
}

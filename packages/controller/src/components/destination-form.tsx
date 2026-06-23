"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Select } from "./ui";
import { createDestination } from "@/app/actions";

export function DestinationForm() {
  const [type, setType] = useState("local");
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
        <Input id="name" name="name" placeholder="paulette-offsite" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Type</Label>
        <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="local">Local folder</option>
          <option value="ssh">SSH / SFTP</option>
          <option value="s3">S3 compatible</option>
        </Select>
      </div>

      {type === "local" && (
        <Field name="basePath" label="Base path" placeholder="/backups" />
      )}

      {type === "ssh" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field name="host" label="Host" placeholder="82.66.67.104" />
            <Field name="port" label="Port" placeholder="22" defaultValue="22" />
          </div>
          <Field name="username" label="Username" placeholder="debian" />
          <Field name="basePath" label="Base path" placeholder="/home/debian/backups" />
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
        </>
      )}

      {type === "s3" && (
        <>
          <Field name="bucket" label="Bucket" placeholder="coolify-backups" />
          <div className="grid grid-cols-2 gap-2">
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

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="encryptionEnabled" /> Encrypt artifacts at rest (AES-256-GCM)
      </label>

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

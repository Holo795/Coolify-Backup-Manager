import type { ResolvedDestination } from "@cbm/shared";

/** Verify a destination is reachable and writable/listable. Runs in the controller. */
export async function testDestination(dest: ResolvedDestination): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    if (dest.type === "local") {
      const { mkdir, writeFile, rm } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(dest.basePath, { recursive: true });
      const probe = join(dest.basePath, `.cbm-probe-${Date.now()}`);
      await writeFile(probe, "ok");
      await rm(probe, { force: true });
      return { ok: true, detail: `Writable: ${dest.basePath}` };
    }

    if (dest.type === "ssh") {
      const mod = await import("ssh2-sftp-client");
      const client = new mod.default();
      await client.connect({
        host: dest.host,
        port: dest.port,
        username: dest.username,
        password: dest.password,
        privateKey: dest.privateKey,
      });
      try {
        const list = await client.list(dest.basePath).catch(() => []);
        return { ok: true, detail: `Connected to ${dest.host}:${dest.port}, ${list.length} entries in ${dest.basePath}` };
      } finally {
        await client.end();
      }
    }

    if (dest.type === "s3") {
      const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: dest.region,
        endpoint: dest.endpoint || undefined,
        forcePathStyle: dest.forcePathStyle,
        credentials: { accessKeyId: dest.accessKeyId, secretAccessKey: dest.secretAccessKey },
      });
      const res = await client.send(new ListObjectsV2Command({ Bucket: dest.bucket, MaxKeys: 1 }));
      client.destroy();
      return { ok: true, detail: `Bucket ${dest.bucket} reachable (${res.KeyCount ?? 0} sample objects)` };
    }

    return { ok: false, error: "Unknown destination type" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

import { copyFile, mkdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, join, posix } from "node:path";
import { once } from "node:events";
import type { ResolvedDestination } from "@cbm/shared";

export interface Transfer {
  /** Upload a local file to the destination under relPath. */
  put(localFile: string, relPath: string): Promise<void>;
  /** Download relPath from the destination into a local file. */
  get(relPath: string, localFile: string): Promise<void>;
  /** List relative file paths under a relative directory prefix. */
  list(relDir: string): Promise<string[]>;
  /** Recursively delete a relative directory. */
  removeDir(relDir: string): Promise<void>;
  close(): Promise<void>;
}

export async function makeTransfer(dest: ResolvedDestination): Promise<Transfer> {
  switch (dest.type) {
    case "local":
      return localTransfer(dest.basePath);
    case "ssh":
      return sshTransfer(dest);
    case "s3":
      return s3Transfer(dest);
  }
}

/* ----------------------------- local ----------------------------- */

function localTransfer(basePath: string): Transfer {
  const abs = (rel: string) => join(basePath, rel);
  return {
    async put(localFile, relPath) {
      const target = abs(relPath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(localFile, target);
    },
    async get(relPath, localFile) {
      await mkdir(dirname(localFile), { recursive: true });
      await copyFile(abs(relPath), localFile);
    },
    async list(relDir) {
      const { readdir } = await import("node:fs/promises");
      const root = abs(relDir);
      const out: string[] = [];
      async function walk(dir: string, prefix: string) {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(join(dir, e.name), rel);
          else out.push(`${relDir}/${rel}`);
        }
      }
      await walk(root, "");
      return out;
    },
    async removeDir(relDir) {
      const { rm } = await import("node:fs/promises");
      await rm(abs(relDir), { recursive: true, force: true });
    },
    async close() {},
  };
}

/* ------------------------------ ssh ------------------------------ */

function sshTransfer(dest: Extract<ResolvedDestination, { type: "ssh" }>): Promise<Transfer> {
  return (async () => {
    const mod = await import("ssh2-sftp-client");
    const SftpClient = mod.default;
    const client = new SftpClient();
    const targetAuth = { username: dest.username, password: dest.password, privateKey: dest.privateKey };

    // Optional bastion: open an SSH connection to the jump host, tunnel a channel
    // to the real target, and hand that socket to the SFTP client. Auth falls
    // back to the target's credentials when the jump fields are omitted.
    let jump: import("ssh2").Client | null = null;
    if (dest.jumpHost) {
      const { Client } = await import("ssh2");
      jump = new Client();
      const j = jump;
      await new Promise<void>((resolve, reject) => {
        j.on("ready", () => resolve())
          .on("error", reject)
          .connect({
            host: dest.jumpHost,
            port: dest.jumpPort,
            username: dest.jumpUsername || dest.username,
            password: dest.jumpPassword || dest.password,
            privateKey: dest.jumpPrivateKey || dest.privateKey,
          });
      });
      const sock = await new Promise<import("stream").Duplex>((resolve, reject) => {
        j.forwardOut("127.0.0.1", 0, dest.host, dest.port, (err, stream) =>
          err ? reject(err) : resolve(stream),
        );
      });
      await client.connect({ sock, ...targetAuth });
    } else {
      await client.connect({ host: dest.host, port: dest.port, ...targetAuth });
    }
    const abs = (rel: string) => posix.join(dest.basePath, rel);
    return {
      async put(localFile, relPath) {
        const target = abs(relPath);
        await client.mkdir(posix.dirname(target), true).catch(() => undefined);
        await client.fastPut(localFile, target);
      },
      async get(relPath, localFile) {
        await mkdir(dirname(localFile), { recursive: true });
        await client.fastGet(abs(relPath), localFile);
      },
      async list(relDir) {
        const root = abs(relDir);
        const out: string[] = [];
        async function walk(dir: string, prefix: string) {
          let entries: Array<{ name: string; type: string }> = [];
          try {
            entries = (await client.list(dir)) as Array<{ name: string; type: string }>;
          } catch {
            return;
          }
          for (const e of entries) {
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.type === "d") await walk(posix.join(dir, e.name), rel);
            else out.push(`${relDir}/${rel}`);
          }
        }
        await walk(root, "");
        return out;
      },
      async removeDir(relDir) {
        await client.rmdir(abs(relDir), true).catch(() => undefined);
      },
      async close() {
        await client.end().catch(() => undefined);
        jump?.end();
      },
    };
  })();
}

/* ------------------------------- s3 ------------------------------- */

function s3Transfer(dest: Extract<ResolvedDestination, { type: "s3" }>): Promise<Transfer> {
  return (async () => {
    const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } =
      await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: dest.region,
      endpoint: dest.endpoint || undefined,
      forcePathStyle: dest.forcePathStyle,
      credentials: {
        accessKeyId: dest.accessKeyId,
        secretAccessKey: dest.secretAccessKey,
      },
    });
    const key = (rel: string) => (dest.prefix ? `${dest.prefix.replace(/\/$/, "")}/${rel}` : rel);
    const list = async (relDir: string): Promise<string[]> => {
      const prefix = key(relDir);
      const out: string[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: dest.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const o of res.Contents ?? []) {
          if (!o.Key) continue;
          const rel = dest.prefix ? o.Key.slice(dest.prefix.replace(/\/$/, "").length + 1) : o.Key;
          out.push(rel);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    };
    return {
      async put(localFile, relPath) {
        const { stat } = await import("node:fs/promises");
        const size = (await stat(localFile)).size;
        await client.send(
          new PutObjectCommand({
            Bucket: dest.bucket,
            Key: key(relPath),
            Body: createReadStream(localFile),
            ContentLength: size,
          }),
        );
      },
      async get(relPath, localFile) {
        await mkdir(dirname(localFile), { recursive: true });
        const res = await client.send(new GetObjectCommand({ Bucket: dest.bucket, Key: key(relPath) }));
        const ws = createWriteStream(localFile);
        (res.Body as NodeJS.ReadableStream).pipe(ws);
        await once(ws, "close");
      },
      list,
      async removeDir(relDir) {
        const files = await list(relDir);
        if (files.length === 0) return;
        await client.send(
          new DeleteObjectsCommand({
            Bucket: dest.bucket,
            Delete: { Objects: files.map((f) => ({ Key: key(f) })) },
          }),
        );
      },
      async close() {
        client.destroy();
      },
    };
  })();
}

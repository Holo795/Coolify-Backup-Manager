import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RestoreJob } from "@cbm/shared";
import { restoreDatabase } from "./dump.js";
import { restoreVolume, stopContainer, startContainer, containerExists } from "./docker.js";
import { decryptFile } from "./crypto.js";
import { makeTransfer } from "./transfer.js";
import { resolveResource } from "./resolve.js";
import type { Emit } from "./backup.js";

export async function runRestore(job: RestoreJob, workDir: string, emit: Emit): Promise<void> {
  const stage = join(workDir, job.id);
  await mkdir(stage, { recursive: true });
  const { manifest } = job;
  const transfer = await makeTransfer(job.source);

  emit("info", `Restoring ${manifest.resource.name} [${manifest.resource.type}] from ${manifest.destinationDir}`, 2);

  try {
    // Download + (optionally) decrypt each artifact into the staging dir.
    const localFiles: Record<string, string> = {};
    let i = 0;
    for (const a of manifest.artifacts) {
      i++;
      emit("info", `Fetching ${a.filename} (${i}/${manifest.artifacts.length})`, 5 + (35 * i) / manifest.artifacts.length);
      const dl = join(stage, a.filename);
      await transfer.get(`${manifest.destinationDir}/${a.filename}`, dl);
      let usable = dl;
      if (a.encrypted) {
        if (!job.decryptionKey) throw new Error("Artifact is encrypted but no decryption key provided");
        usable = join(stage, a.filename.replace(/\.enc$/, ""));
        await decryptFile(dl, usable, job.decryptionKey);
      }
      localFiles[a.filename] = usable;
    }

    const dumps = manifest.artifacts.filter((a) => a.kind === "db-dump");
    const volumes = manifest.artifacts.filter((a) => a.kind === "volume");

    // Where to restore INTO: for "→ new" the freshly-cloned Coolify resource
    // (resolved from its uuid on the live host), else the original. The clone
    // keeps the same DB name + credentials, so the dump loads as-is, and the
    // original is never touched in new mode.
    const isNew = job.target === "new_resource";
    const into = isNew && job.targetResource ? job.targetResource : manifest.resource;
    if (isNew && !job.targetResource) {
      throw new Error("Restore → new resource: the controller provided no cloned target");
    }

    // Restore DB dumps into the target container (logical restore, no downtime).
    if (dumps.length > 0) {
      // Re-resolve container + credentials from the live Docker host (manifest
      // intentionally carries no secrets).
      const resolved = await resolveResource(into);
      const container = resolved.containerName ?? into.containerName ?? job.targetContainerName;
      if (!container) throw new Error(`DB restore requires a target container (resolving ${into.name})`);
      // Prefer the controller-provided creds (authoritative, from the Coolify
      // API) over whatever was read from the container env.
      const creds = job.db ?? resolved.db ?? {};
      for (const d of dumps) {
        emit("info", `Restoring dump ${d.filename} into ${into.name} (${container})`, 50);
        await restoreDatabase(into.type, container, creds, localFiles[d.filename]);
      }
    }

    // Restore volumes.
    if (volumes.length > 0 && isNew) {
      // → new: the clone isn't deployed, so just pre-fill its (uuid-swapped)
      // volumes. Never touch the original resource's containers/volumes. The
      // data is mounted when the operator first deploys the clone.
      for (const v of volumes) {
        const src = v.meta.volume;
        const dest = src ? job.volumeMap?.[src] : undefined;
        if (!dest) {
          emit("warn", `No clone volume mapping for "${src ?? v.filename}" — skipping (restore it manually after deploy)`);
          continue;
        }
        emit("info", `Restoring volume ${src} → ${dest}`, 70);
        await restoreVolume(dest, localFiles[v.filename]);
      }
    } else if (volumes.length > 0) {
      // in place: stop the resource, overwrite its volumes, restart.
      const containers = manifest.resource.containerNames.length
        ? manifest.resource.containerNames
        : manifest.resource.containerName
          ? [manifest.resource.containerName]
          : [];
      const stopped: string[] = [];
      try {
        for (const c of containers) {
          if (await containerExists(c)) {
            emit("info", `Stopping ${c} for volume restore`);
            await stopContainer(c);
            stopped.push(c);
          }
        }
        for (const v of volumes) {
          const volName = v.meta.volume;
          if (!volName) {
            emit("warn", `Volume artifact ${v.filename} has no volume name; skipping`);
            continue;
          }
          emit("info", `Restoring volume ${volName}`, 70);
          await restoreVolume(volName, localFiles[v.filename]);
        }
      } finally {
        for (const c of stopped.reverse()) {
          emit("info", `Restarting ${c}`);
          await startContainer(c).catch((e) => emit("error", `Failed to restart ${c}: ${(e as Error).message}`));
        }
      }
    }

    // For a freshly-cloned app/service, remind the operator of the manual steps
    // we intentionally skip (no deploy, no domain).
    if (isNew && (into.type === "application" || into.type === "service")) {
      emit(
        "warn",
        `New ${into.type} "${into.name}" created but NOT deployed. In Coolify: set its environment variables and a ` +
          `domain/URL, then deploy. Restored volume data will be mounted on first deploy.`,
      );
    }

    if (manifest.provenance.gitCommitSha || manifest.provenance.imageDigest) {
      emit(
        "warn",
        `Code provenance recorded (commit=${manifest.provenance.gitCommitSha ?? "?"}, image=${manifest.provenance.imageDigest ?? "?"}). ` +
          `Re-pin the deployment in Coolify to match the restored data (controller handles this).`,
      );
    }

    emit("info", "Restore complete", 100);
  } finally {
    await transfer.close();
    await rm(stage, { recursive: true, force: true });
  }
}

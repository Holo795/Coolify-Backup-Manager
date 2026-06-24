import type { Provenance } from "@cbm/shared";
import { inspectContainer, inspectImage } from "./docker.js";

/**
 * Capture git commit / image provenance for a resource by inspecting its
 * running container and image. The Coolify API stores git_commit_sha = "HEAD"
 * (not the resolved SHA), so the only reliable source is Docker itself.
 */
export async function captureProvenance(container: string): Promise<Provenance> {
  const prov: Provenance = {};
  const c = await inspectContainer(container);
  if (!c) return prov;

  const imageRef: string | undefined = c.Config?.Image;
  prov.imageRef = imageRef;

  const labels: Record<string, string> = c.Config?.Labels ?? {};
  prov.gitCommitSha = findCommit(labels);

  const imageName = imageRef ?? c.Image;
  if (imageName) {
    const img = await inspectImage(imageName);
    if (img) {
      // Prefer a pullable repo digest (name@sha256:…) over the local image id,
      // so a "latest"/floating tag can be re-pinned to the exact deployed image.
      const digest: string | undefined = (img.RepoDigests ?? [])[0];
      prov.imageDigest = digest ?? img.Id;
      if (!prov.gitCommitSha) {
        prov.gitCommitSha = findCommit(img.Config?.Labels ?? {});
      }
    }
  }

  // Coolify tags images it builds from git with the resolved commit SHA
  // (e.g. "<resource>_<name>:<40-hex>"). When no label carried the commit, use
  // that tag so a git app can be re-pinned to the code that matches the data.
  if (!prov.gitCommitSha && imageRef) {
    const tag = imageRef.includes("@") ? undefined : imageRef.split(":").pop();
    if (tag && /^[0-9a-f]{7,40}$/i.test(tag)) prov.gitCommitSha = tag;
  }
  return prov;
}

function findCommit(labels: Record<string, string>): string | undefined {
  for (const [k, v] of Object.entries(labels)) {
    const key = k.toLowerCase();
    if (
      (key.includes("commit") || key.includes("git.sha") || key.includes("revision")) &&
      /^[0-9a-f]{7,40}$/i.test(v)
    ) {
      return v;
    }
  }
  return undefined;
}

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
      const digest: string | undefined = (img.RepoDigests ?? [])[0];
      prov.imageDigest = digest ?? img.Id;
      if (!prov.gitCommitSha) {
        prov.gitCommitSha = findCommit(img.Config?.Labels ?? {});
      }
    }
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

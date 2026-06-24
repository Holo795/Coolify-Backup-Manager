import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { CoolifyClient } from "./coolify";

/** Sync all resources for a Coolify instance into the local DB. */
export async function syncInstance(instanceId: string): Promise<{ synced: number }> {
  const instance = await prisma.coolifyInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const token = decryptSecret(instance.apiTokenEnc);
  const client = new CoolifyClient(instance.baseUrl, token);
  const resources = await client.listResources();

  let synced = 0;
  for (const r of resources) {
    if (!r.uuid) continue;
    await prisma.resource.upsert({
      where: { instanceId_coolifyUuid: { instanceId, coolifyUuid: r.uuid } },
      create: {
        instanceId,
        coolifyUuid: r.uuid,
        name: r.name,
        type: r.type,
        projectName: r.projectName,
        environment: r.environment,
        buildPack: r.buildPack,
        status: r.status,
      },
      update: {
        name: r.name,
        type: r.type,
        projectName: r.projectName,
        environment: r.environment,
        buildPack: r.buildPack,
        status: r.status,
      },
    });
    synced++;
  }

  // Prune resources that no longer exist in Coolify (e.g. a "→ new" clone that
  // was deleted). Only those with no snapshots are removed, so backup history
  // of a genuinely deleted resource isn't lost. Skip if the fetch came back
  // empty (transient) to avoid wiping everything. coolify-self is synthetic.
  const seen = resources.map((r) => r.uuid).filter((u): u is string => !!u);
  if (seen.length > 0) {
    const stale = await prisma.resource.findMany({
      where: {
        instanceId,
        coolifyUuid: { notIn: seen },
        NOT: { coolifyUuid: { startsWith: "coolify-self" } },
      },
      select: { id: true, _count: { select: { snapshots: true } } },
    });
    const toDelete = stale.filter((r) => r._count.snapshots === 0).map((r) => r.id);
    if (toDelete.length) await prisma.resource.deleteMany({ where: { id: { in: toDelete } } });
  }

  await prisma.coolifyInstance.update({
    where: { id: instanceId },
    data: { lastSyncedAt: new Date() },
  });
  return { synced };
}

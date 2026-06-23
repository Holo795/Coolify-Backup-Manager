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

  await prisma.coolifyInstance.update({
    where: { id: instanceId },
    data: { lastSyncedAt: new Date() },
  });
  return { synced };
}

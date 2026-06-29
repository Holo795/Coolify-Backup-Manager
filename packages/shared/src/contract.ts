import { z } from "zod";
import { ArtifactKind, EventLevel, JobStatus, JobType, PolicyMode, ResourceType } from "./enums.js";

/* ------------------------------------------------------------------ *
 * Destination (resolved config sent to the agent for a single job)    *
 * ------------------------------------------------------------------ */

export const LocalDestination = z.object({
  type: z.literal("local"),
  basePath: z.string().min(1),
});

export const SshDestination = z.object({
  type: z.literal("ssh"),
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  username: z.string().min(1),
  basePath: z.string().min(1),
  // Exactly one auth method is provided at job time.
  password: z.string().optional(),
  privateKey: z.string().optional(),
  // Optional jump host (bastion): the agent connects here first, then tunnels to
  // `host` above. Auth falls back to the target's key/password when omitted.
  jumpHost: z.string().optional(),
  jumpPort: z.number().int().positive().default(22),
  jumpUsername: z.string().optional(),
  jumpPassword: z.string().optional(),
  jumpPrivateKey: z.string().optional(),
});

export const S3Destination = z.object({
  type: z.literal("s3"),
  endpoint: z.string().optional(), // for S3-compatible (MinIO, etc.)
  region: z.string().default("us-east-1"),
  bucket: z.string().min(1),
  prefix: z.string().default(""),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().default(false),
});

export const ResolvedDestination = z.discriminatedUnion("type", [
  LocalDestination,
  SshDestination,
  S3Destination,
]);
export type ResolvedDestination = z.infer<typeof ResolvedDestination>;

/**
 * How artifacts are stored at the destination:
 *  - "tar"   : one archive/dump file per artifact (default, all destination types).
 *  - "restic": an incremental, deduplicated, encrypted restic repository — the
 *    agent stages artifacts then `restic backup`s them; only changed data is
 *    uploaded. `resticPassword` unlocks the repo. (local & s3 destinations.)
 */
export const StorageSpec = z.object({
  engine: z.enum(["tar", "restic"]).default("tar"),
  resticPassword: z.string().optional(),
});
export type StorageSpec = z.infer<typeof StorageSpec>;

/* ------------------------------------------------------------------ *
 * Encryption                                                          *
 * ------------------------------------------------------------------ */

export const EncryptionSpec = z.object({
  enabled: z.boolean(),
  /** Base64-encoded 32-byte symmetric key (AES-256-GCM) when enabled. */
  key: z.string().optional(),
});
export type EncryptionSpec = z.infer<typeof EncryptionSpec>;

/* ------------------------------------------------------------------ *
 * Resource descriptor (what the agent needs to act on a resource)     *
 * ------------------------------------------------------------------ */

export const DbCredentials = z.object({
  user: z.string().optional(),
  password: z.string().optional(),
  database: z.string().optional(),
});
export type DbCredentials = z.infer<typeof DbCredentials>;

export const ResourceDescriptor = z.object({
  coolifyUuid: z.string(),
  name: z.string(),
  type: ResourceType,
  /** Primary container name (or compose project) on the Docker host. */
  containerName: z.string().optional(),
  /** All containers belonging to this resource (compose/service). */
  containerNames: z.array(z.string()).default([]),
  /** Docker volumes belonging to this resource. */
  volumes: z.array(z.string()).default([]),
  /** Host-path (bind) mounts holding data, with the container that mounts them. */
  bindMounts: z.array(z.object({ source: z.string(), container: z.string() })).default([]),
  /** Credentials for logical dumps (hot mode). */
  db: DbCredentials.optional(),
});
export type ResourceDescriptor = z.infer<typeof ResourceDescriptor>;

/* ------------------------------------------------------------------ *
 * Artifacts & Snapshot manifest                                       *
 * ------------------------------------------------------------------ */

export const Artifact = z.object({
  kind: ArtifactKind,
  /** File name as stored at the destination (relative to the snapshot dir). */
  filename: z.string(),
  sizeBytes: z.number().int().nonnegative().default(0),
  sha256: z.string().optional(),
  encrypted: z.boolean().default(false),
  /** For db-dump: the engine used. For volume: the volume name. */
  meta: z.record(z.string(), z.string()).default({}),
});
export type Artifact = z.infer<typeof Artifact>;

/** Git/image provenance captured by the agent via `docker inspect`. */
export const Provenance = z.object({
  gitCommitSha: z.string().optional(),
  imageRef: z.string().optional(),
  imageDigest: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const SnapshotManifest = z.object({
  version: z.literal(1).default(1),
  resource: ResourceDescriptor,
  mode: PolicyMode,
  /** How it was captured, for display: "dump" | "frozen" | "live" | … */
  captureMode: z.string(),
  capturedAt: z.string(), // ISO timestamp, stamped by controller/agent
  artifacts: z.array(Artifact).default([]),
  provenance: Provenance.default({}),
  /** Encrypted env vars blob filename (config artifact holds compose/config). */
  envArtifact: z.string().optional(),
  /** The resource's env vars (master-key-encrypted JSON), so the snapshot can be
   * restored even if the original resource no longer exists in Coolify. */
  envEnc: z.string().optional(),
  encrypted: z.boolean().default(false),
  /** Relative directory at the destination that holds this snapshot. */
  destinationDir: z.string(),
  /** restic snapshot id when stored via the restic engine. */
  resticSnapshotId: z.string().optional(),
  notes: z.string().optional(),
});
export type SnapshotManifest = z.infer<typeof SnapshotManifest>;

/* ------------------------------------------------------------------ *
 * Jobs (controller -> agent)                                          *
 * ------------------------------------------------------------------ */

export const BackupJob = z.object({
  id: z.string(),
  type: z.literal("backup"),
  mode: PolicyMode,
  /** When true, copy volumes live without ever freezing a container (at the
   * operator's risk of inconsistency). Default: freeze RW containers briefly. */
  liveBackup: z.boolean().default(false),
  /** The resource's environment variables, JSON then master-key-encrypted by the
   * controller. The agent stores it verbatim in the manifest (it can't read it),
   * so a backup is self-contained for a later restore. */
  envEnc: z.string().optional(),
  resource: ResourceDescriptor,
  destination: ResolvedDestination,
  encryption: EncryptionSpec,
  storage: StorageSpec.default({ engine: "tar" }),
  /** Optional pre/post commands, one entry per container (`container` "" or an
   * unknown name → the resource's primary container). Pre runs before capture
   * (a failure aborts), post always runs after. */
  hooks: z
    .array(z.object({ container: z.string().default(""), pre: z.string().optional(), post: z.string().optional() }))
    .optional(),
  /** Relative directory to write into (controller decides naming). */
  destinationDir: z.string(),
});
export type BackupJob = z.infer<typeof BackupJob>;

export const RestoreJob = z.object({
  id: z.string(),
  type: z.literal("restore"),
  manifest: SnapshotManifest,
  source: ResolvedDestination,
  storage: StorageSpec.default({ engine: "tar" }),
  /** restic snapshot id to restore from (restic engine). */
  resticSnapshotId: z.string().optional(),
  /** Base64 AES-256-GCM key when artifacts are encrypted. */
  decryptionKey: z.string().optional(),
  target: z.enum(["in_place", "new_resource"]).default("in_place"),
  /** When restoring DB dumps, the target container to exec into. */
  targetContainerName: z.string().optional(),
  db: DbCredentials.optional(),
  /**
   * For target=new_resource: the freshly-cloned Coolify resource the agent
   * should restore INTO (resolved from its uuid on the live host), instead of
   * the snapshot's original resource. The original is never touched.
   */
  targetResource: ResourceDescriptor.optional(),
  /**
   * For target=new_resource with volumes: maps each original docker volume name
   * to the clone's volume name (derived by swapping the resource uuid). The
   * agent pre-creates + fills the target volume so data is present on first
   * deploy. Volumes with no mapping are skipped (the original is never touched).
   */
  volumeMap: z.record(z.string(), z.string()).optional(),
});
export type RestoreJob = z.infer<typeof RestoreJob>;

export const PruneJob = z.object({
  id: z.string(),
  type: z.literal("prune"),
  destination: ResolvedDestination,
  storage: StorageSpec.default({ engine: "tar" }),
  /** Relative directories at the destination to delete recursively (tar engine). */
  dirs: z.array(z.string()),
  /** For the restic engine: forget snapshots by restic snapshot id, then prune. */
  resticSnapshotIds: z.array(z.string()).optional(),
});
export type PruneJob = z.infer<typeof PruneJob>;

export const VerifyDestinationJob = z.object({
  id: z.string(),
  type: z.literal("verify-destination"),
  destination: ResolvedDestination,
  storage: StorageSpec.default({ engine: "tar" }),
  /** Snapshot directories whose files should still be present at the destination
   * (tar engine). The agent reports which are present vs missing. */
  dirs: z.array(z.string()),
  /** For the restic engine: the restic snapshot ids to confirm still exist. The
   * agent reports the present/missing sets using these ids as the keys. */
  resticSnapshotIds: z.array(z.string()).optional(),
});
export type VerifyDestinationJob = z.infer<typeof VerifyDestinationJob>;

export const Job = z.discriminatedUnion("type", [BackupJob, RestoreJob, PruneJob, VerifyDestinationJob]);
export type Job = z.infer<typeof Job>;

/* ------------------------------------------------------------------ *
 * Agent <-> controller messages                                       *
 * ------------------------------------------------------------------ */

export const AgentRegisterRequest = z.object({
  // Per-instance enrollment token: authenticates the agent AND identifies which
  // Coolify instance it serves (zero-config auto-link).
  enrollmentToken: z.string().min(1),
  hostname: z.string().min(1),
  agentVersion: z.string().default("0.1.0"),
  /** Optional install-time override (AGENT_SERVER_UUID): pins this agent to a
   * Coolify server, disabling auto-detection. */
  serverUuid: z.string().optional(),
});
export type AgentRegisterRequest = z.infer<typeof AgentRegisterRequest>;

export const AgentRegisterResponse = z.object({
  agentId: z.string(),
  agentToken: z.string(),
});
export type AgentRegisterResponse = z.infer<typeof AgentRegisterResponse>;

export const HeartbeatRequest = z.object({
  dockerVersion: z.string().optional(),
  containers: z.number().int().nonnegative().optional(),
  /** Coolify resource UUIDs the agent can see on its local Docker host (from
   * volume/container names). The controller matches them to known resources to
   * auto-detect which server this agent backs up. */
  resourceUuids: z.array(z.string()).optional(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>;

/** Long-poll response: a job to run, or null when idle. */
export const PollResponse = z.object({
  job: Job.nullable(),
});
export type PollResponse = z.infer<typeof PollResponse>;

export const JobEvent = z.object({
  jobId: z.string(),
  ts: z.string(),
  level: EventLevel.default("info"),
  message: z.string(),
  progress: z.number().min(0).max(100).optional(),
});
export type JobEvent = z.infer<typeof JobEvent>;

export const JobResult = z.object({
  jobId: z.string(),
  status: JobStatus,
  manifest: SnapshotManifest.optional(),
  error: z.string().optional(),
  /** restic snapshot id created by a restic-engine backup (for forget/verify). */
  resticSnapshotId: z.string().optional(),
  /** For a verify-destination job: which snapshot dirs are still present vs gone. */
  verify: z
    .object({
      present: z.array(z.string()).default([]),
      missing: z.array(z.string()).default([]),
    })
    .optional(),
});
export type JobResult = z.infer<typeof JobResult>;

/* Re-export job/status enums for convenience. */
export { JobType, JobStatus };

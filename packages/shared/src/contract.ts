import { z } from "zod";
import {
  ArtifactKind,
  CaptureMode,
  DestinationType,
  EventLevel,
  JobStatus,
  JobType,
  PolicyMode,
  ResourceType,
} from "./enums.js";

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
  captureMode: CaptureMode,
  capturedAt: z.string(), // ISO timestamp, stamped by controller/agent
  artifacts: z.array(Artifact).default([]),
  provenance: Provenance.default({}),
  /** Encrypted env vars blob filename (config artifact holds compose/config). */
  envArtifact: z.string().optional(),
  encrypted: z.boolean().default(false),
  /** Relative directory at the destination that holds this snapshot. */
  destinationDir: z.string(),
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
  captureMode: CaptureMode,
  resource: ResourceDescriptor,
  destination: ResolvedDestination,
  encryption: EncryptionSpec,
  /** Relative directory to write into (controller decides naming). */
  destinationDir: z.string(),
});
export type BackupJob = z.infer<typeof BackupJob>;

export const RestoreJob = z.object({
  id: z.string(),
  type: z.literal("restore"),
  manifest: SnapshotManifest,
  source: ResolvedDestination,
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
});
export type RestoreJob = z.infer<typeof RestoreJob>;

export const PruneJob = z.object({
  id: z.string(),
  type: z.literal("prune"),
  destination: ResolvedDestination,
  /** Relative directories at the destination to delete recursively. */
  dirs: z.array(z.string()),
});
export type PruneJob = z.infer<typeof PruneJob>;

export const Job = z.discriminatedUnion("type", [BackupJob, RestoreJob, PruneJob]);
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
});
export type JobResult = z.infer<typeof JobResult>;

/* Re-export job/status enums for convenience. */
export { JobType, JobStatus };

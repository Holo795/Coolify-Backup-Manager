import { z } from "zod";

/** Coolify resource kinds we know how to handle. */
export const ResourceType = z.enum([
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "keydb",
  "dragonfly",
  "clickhouse",
  "application",
  "service",
]);
export type ResourceType = z.infer<typeof ResourceType>;

/** Database engines we can take a logical dump of (hot mode). */
export const DUMPABLE_DB_TYPES: ResourceType[] = [
  "postgresql",
  "mysql",
  "mariadb",
  "mongodb",
];

/** How a snapshot is captured. */
export const CaptureMode = z.enum(["cold", "hot"]);
export type CaptureMode = z.infer<typeof CaptureMode>;

/** Policy mode: versioned backups vs single overwritten mirror. */
export const PolicyMode = z.enum(["backup", "sync"]);
export type PolicyMode = z.infer<typeof PolicyMode>;

/** What an individual artifact in a snapshot contains. */
export const ArtifactKind = z.enum([
  "db-dump",
  "volume",
  "config",
  "image-ref",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const JobType = z.enum(["backup", "restore"]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const DestinationType = z.enum(["local", "ssh", "s3"]);
export type DestinationType = z.infer<typeof DestinationType>;

export const EventLevel = z.enum(["debug", "info", "warn", "error"]);
export type EventLevel = z.infer<typeof EventLevel>;

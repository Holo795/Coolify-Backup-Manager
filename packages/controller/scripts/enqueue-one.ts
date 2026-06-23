import "dotenv/config";
import { enqueueBackup } from "@/lib/jobs";
const resourceId = process.argv[2];
const r = await enqueueBackup(resourceId);
console.log(r.snapshotId);
process.exit(0);

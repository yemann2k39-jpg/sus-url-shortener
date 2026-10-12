// Cleanup helper: wipe ALL links (test probes) - user-approved clean slate
import { linksWipeAll } from "../lib/store.js";
await linksWipeAll();
console.log("links table wiped");

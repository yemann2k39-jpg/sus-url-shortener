// Cleanup helper: wipe ALL links (test probes) - user-approved clean slate
import { linksWipeAll } from "../lib/store.js";
linksWipeAll();
console.log("links table wiped");

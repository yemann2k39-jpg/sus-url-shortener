// One-time (TCK-19): export all links to a dated backup file, then wipe the table.
// Pre-accounts links have no owner - the user chose deletion over migration.
import { listLinks, deleteLink } from "../lib/store.js";
import { writeFileSync } from "node:fs";

// paginate through everything
const links = [];
let offset = 0;
for (;;) {
  const page = await listLinks({ limit: 100, offset });
  links.push(...page);
  if (page.length < 100) break;
  offset += 100;
}
const backupPath = "data/links-backup-2026-10-06.json";
writeFileSync(backupPath, JSON.stringify(links, null, 2), "utf8");
console.log(`backed up ${links.length} link(s) to ${backupPath}`);
for (const link of links) {
  await deleteLink(link.slug);
}
console.log(`wiped ${links.length} link(s) from the live table`);

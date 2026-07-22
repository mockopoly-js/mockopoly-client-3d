// Re-copies the wire contract from a sibling mockopoly-server checkout.
// Server is the source of truth. Run: npm run sync-contract
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverTypes = resolve(here, '../../mockopoly-server/src/types');
const clientTypes = resolve(here, '../src/types');
const files = ['GameState.ts', 'SocketEvents.ts'];

if (!existsSync(serverTypes)) {
  console.error(`[sync-contract] server types not found at ${serverTypes}`);
  console.error('[sync-contract] check out mockopoly-server as a sibling directory.');
  process.exit(1);
}

for (const f of files) {
  copyFileSync(resolve(serverTypes, f), resolve(clientTypes, f));
  console.log(`[sync-contract] copied ${f}`);
}
console.log('[sync-contract] done. Server is the source of truth.');

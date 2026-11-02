// EDGE-2 — the guard for /reader/<slug> addresses that may hold a preserved copy of a page this
// deployment no longer has. ONLY the addresses out/_routes.json lists reach it (written by
// scripts/generate-edge-guard.mjs); every live page goes straight to the asset server, with no
// Function. See app/lib/edgeGuard.mjs.
import { guardRequest } from '../../app/lib/edgeGuard.mjs';

export const onRequest = (context) => guardRequest(context);

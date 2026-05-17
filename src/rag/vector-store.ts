// Vector store APIs are colocated in sqlite-store.ts since vec0 lives in the
// same .db file as docs/docs_fts (single connection, single transaction).
// This barrel exists for future-proofing: if Phase 2 / Story 7.x splits the
// vector backend (e.g. LanceDB, Pinecone), the namespace is already reserved
// on the public API surface.
export { openIndex } from './sqlite-store.js';
export type { IndexHandle, VecHit } from './types.js';

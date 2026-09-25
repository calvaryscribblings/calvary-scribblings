// The two founder accounts. Public identifiers (a uid is not a secret), shared by the client and
// the Functions. Used by the W4 founder-only preview of the archive gate: a founder can see the
// site as it will be after 30 September, and the preview changes nothing for anyone else.
export const FOUNDER_UIDS = Object.freeze(['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1']);
export const isFounder = (uid) => typeof uid === 'string' && FOUNDER_UIDS.includes(uid);

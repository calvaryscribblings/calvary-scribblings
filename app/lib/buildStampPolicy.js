// Ruling 190 (W52): no reader sees a build ID. The stamp shows only to a founder, in the site
// footer: it is how the founders confirm a device is on the latest build. /build.json and the
// commit baked into the scripts are unchanged; deploy checks read those, never the page.
//
// The check is /admin's own founder check (app/lib/founders.js). Signed out → no uid → no stamp.
import { isFounder } from './founders.js';

export const showsBuildStamp = (uid) => isFounder(uid);

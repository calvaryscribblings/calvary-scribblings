// calvary-account-purge — daily cron Worker that hard-deletes accounts whose
// 7-day grace window has expired. Triggered at 03:00 UTC by Cloudflare's cron
// scheduler. See the deletion spec in CLAUDE.md / GDPR docs for the full
// list of nodes this is responsible for cleaning.
//
// Architecture:
//   - Firebase service account JSON (Worker secret) → OAuth2 access token
//     via Web Crypto RS256 JWT signing.
//   - RTDB writes use the Database REST API with that token.
//   - Auth user deletes use the Identity Toolkit (v1) REST API with the
//     same token. The service account must have the
//     `roles/firebaseauth.admin` role for accounts:delete to succeed.
//
// Manual invocation for testing:
//   curl -X POST https://calvary-account-purge.<subdomain>.workers.dev/run \
//     -H "Authorization: Bearer $PURGE_TRIGGER_TOKEN"

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ');

// ──────────────────────────────────────────────────────────────────────────
// JWT minting (RS256 via Web Crypto).
// ──────────────────────────────────────────────────────────────────────────

function b64url(input) {
  let str;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    str = btoa(bin);
  } else {
    str = btoa(input);
  }
  return str.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function mintAccessToken(serviceAccountJson) {
  const sa = typeof serviceAccountJson === 'string'
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${t}`);
  }
  const { access_token, expires_in } = await res.json();
  return { token: access_token, expiresAt: now + (expires_in || 3600) - 60, projectId: sa.project_id };
}

// ──────────────────────────────────────────────────────────────────────────
// RTDB REST helpers.
// ──────────────────────────────────────────────────────────────────────────

async function rtdbReq(env, token, method, path, body, params = '') {
  const url = `${env.DATABASE_URL}${path}.json?access_token=${encodeURIComponent(token)}${params ? '&' + params : ''}`;
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`RTDB ${method} ${path} failed: ${res.status} ${t}`);
  }
  if (method === 'DELETE') return null;
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const dbGet     = (env, t, p, params)       => rtdbReq(env, t, 'GET', p, undefined, params);
const dbDelete  = (env, t, p)               => rtdbReq(env, t, 'DELETE', p);
const dbPatch   = (env, t, p, body)         => rtdbReq(env, t, 'PATCH', p, body);
const dbPost    = (env, t, p, body)         => rtdbReq(env, t, 'POST', p, body);

// ──────────────────────────────────────────────────────────────────────────
// Identity Toolkit — delete the Auth user.
// ──────────────────────────────────────────────────────────────────────────

async function deleteAuthUser(token, projectId, uid) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: uid }),
    }
  );
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`Auth delete failed for ${uid}: ${res.status} ${t}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-user purge routine.
// ──────────────────────────────────────────────────────────────────────────

async function purgeUser(env, token, projectId, uid, userData) {
  const counts = {
    cms_stories_deleted: 0,
    square_posts_deleted: 0,
    comments_deleted: 0,
    quote_references_cleared: 0,
    follower_links_cleared: 0,
    notifications_swept: 0,
    library_notifications_swept: 0,
    reactions_swept: 0,
  };

  // 1. CMS stories authored by this user.
  const cmsStories = await dbGet(env, token, '/cms_stories');
  if (cmsStories) {
    for (const [id, s] of Object.entries(cmsStories)) {
      if (s && s.authorUid === uid) {
        await dbDelete(env, token, `/cms_stories/${id}`);
        counts.cms_stories_deleted++;
      }
    }
  }

  // 2. Square posts authored by this user. Track post IDs so we can clear
  //    quotedPostId references in remaining posts (and so reactions for
  //    those posts can be cleaned up by deleting the parent reaction node).
  const deletedPostIds = new Set();
  const squarePosts = await dbGet(env, token, '/square_posts');
  if (squarePosts) {
    for (const [id, p] of Object.entries(squarePosts)) {
      if (p && p.authorUid === uid) {
        await dbDelete(env, token, `/square_posts/${id}`);
        await dbDelete(env, token, `/square_reactions/${id}`);
        deletedPostIds.add(id);
        counts.square_posts_deleted++;
      }
    }
    // 2b. Clear quotedPostId on any post that quoted one we just deleted.
    for (const [id, p] of Object.entries(squarePosts)) {
      if (p && p.quotedPostId && deletedPostIds.has(p.quotedPostId)) {
        await dbPatch(env, token, `/square_posts/${id}`, {
          quotedPostId: null,
          quoteOriginalDeleted: true,
        });
        counts.quote_references_cleared++;
      }
    }
  }

  // 3. Sweep square_reactions/*/<type>/<uid> — the user's reactions on
  //    other people's posts. Also decrement the count cache.
  const allReactions = await dbGet(env, token, '/square_reactions');
  if (allReactions) {
    for (const [postId, byType] of Object.entries(allReactions)) {
      if (!byType) continue;
      for (const [type, byUser] of Object.entries(byType)) {
        if (byUser && byUser[uid]) {
          await dbDelete(env, token, `/square_reactions/${postId}/${type}/${uid}`);
          // Best-effort decrement of the cache; ignore if the post is gone.
          try {
            const cur = await dbGet(env, token, `/square_posts/${postId}/${type}Count`);
            if (typeof cur === 'number' && cur > 0) {
              await dbPatch(env, token, `/square_posts/${postId}`, { [`${type}Count`]: cur - 1 });
            }
          } catch {}
          counts.reactions_swept++;
        }
      }
    }
  }

  // 4. Story comments authored by this user (across all slugs).
  const allComments = await dbGet(env, token, '/comments');
  if (allComments) {
    for (const [slug, byId] of Object.entries(allComments)) {
      if (!byId) continue;
      for (const [commentId, c] of Object.entries(byId)) {
        if (c && c.authorUid === uid) {
          await dbDelete(env, token, `/comments/${slug}/${commentId}`);
          counts.comments_deleted++;
        }
      }
    }
  }

  // 5. Comment reactions by this user (per-slug user-keyed nodes).
  const commentReactions = await dbGet(env, token, '/comment_reactions');
  if (commentReactions) {
    for (const slug of Object.keys(commentReactions)) {
      if (commentReactions[slug] && commentReactions[slug][uid]) {
        await dbDelete(env, token, `/comment_reactions/${slug}/${uid}`);
      }
    }
  }

  // 6. Follow relationship cleanup. The followers/{uid} and following/{uid}
  //    nodes get deleted wholesale. Then sweep other users' lists for back-
  //    references.
  await dbDelete(env, token, `/followers/${uid}`);
  await dbDelete(env, token, `/following/${uid}`);
  const allFollowers = await dbGet(env, token, '/followers');
  if (allFollowers) {
    for (const ownerUid of Object.keys(allFollowers)) {
      if (allFollowers[ownerUid] && allFollowers[ownerUid][uid]) {
        await dbDelete(env, token, `/followers/${ownerUid}/${uid}`);
        counts.follower_links_cleared++;
      }
    }
  }
  const allFollowing = await dbGet(env, token, '/following');
  if (allFollowing) {
    for (const ownerUid of Object.keys(allFollowing)) {
      if (allFollowing[ownerUid] && allFollowing[ownerUid][uid]) {
        await dbDelete(env, token, `/following/${ownerUid}/${uid}`);
        counts.follower_links_cleared++;
      }
    }
  }

  // 7. Notifications. Two trees: square (`notifications/`) and library
  //    (`library_notifications/`). Delete the user's own inbox, then sweep
  //    everyone else's inbox for entries fromUid === uid.
  await dbDelete(env, token, `/notifications/${uid}`);
  const allNotifs = await dbGet(env, token, '/notifications');
  if (allNotifs) {
    for (const [ownerUid, inbox] of Object.entries(allNotifs)) {
      if (!inbox) continue;
      for (const [notifId, n] of Object.entries(inbox)) {
        if (n && n.fromUid === uid) {
          await dbDelete(env, token, `/notifications/${ownerUid}/${notifId}`);
          counts.notifications_swept++;
        }
      }
    }
  }

  await dbDelete(env, token, `/library_notifications/${uid}`);
  const allLibNotifs = await dbGet(env, token, '/library_notifications');
  if (allLibNotifs) {
    for (const [ownerUid, inbox] of Object.entries(allLibNotifs)) {
      if (!inbox) continue;
      for (const [notifId, n] of Object.entries(inbox)) {
        if (n && n.fromUid === uid) {
          await dbDelete(env, token, `/library_notifications/${ownerUid}/${notifId}`);
          counts.library_notifications_swept++;
        }
      }
    }
  }

  // 8. Per-user denorm nodes — drop wholesale.
  await dbDelete(env, token, `/userBadges/${uid}`);
  await dbDelete(env, token, `/userStreaks/${uid}`);
  await dbDelete(env, token, `/quiz_submissions/${uid}`);
  await dbDelete(env, token, `/points/${uid}`);
  await dbDelete(env, token, `/leaderboard/${uid}`);
  await dbDelete(env, token, `/user_square_posts/${uid}`);

  // 9. Username index — must use the handle stored on the user node.
  const handle = userData?.username;
  if (handle) await dbDelete(env, token, `/usernames/${handle}`);

  // 10. The user node itself goes last so the rest of the sweep can still
  //     read fields like `username` from it.
  await dbDelete(env, token, `/users/${uid}`);

  // 11. Auth user (irreversible — do this only after the RTDB sweep
  //     succeeds, otherwise a partial purge leaves an Auth-less profile).
  await deleteAuthUser(token, projectId, uid);

  return counts;
}

// ──────────────────────────────────────────────────────────────────────────
// Top-level sweep.
// ──────────────────────────────────────────────────────────────────────────

async function runPurge(env) {
  const { token, projectId } = await mintAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Date.now();
  const adminUid = env.ADMIN_UID;

  const users = await dbGet(env, token, '/users');
  if (!users) return { processed: 0, results: [] };

  const results = [];
  for (const [uid, u] of Object.entries(users)) {
    // Hard guard — the admin account is never deletable, regardless of
    // any database state. This is the last line of defence.
    if (uid === adminUid) continue;
    if (!u || u.isDeleted !== true) continue;
    const scheduledFor = u.pendingDeletion?.scheduledFor;
    if (typeof scheduledFor !== 'number' || scheduledFor > now) continue;

    const audit = {
      uid,
      email_at_deletion: u.email || null,
      username_at_deletion: u.username || null,
      deletion_completed_at: null,
      content_counts: null,
      error: null,
    };

    try {
      const counts = await purgeUser(env, token, projectId, uid, u);
      audit.content_counts = counts;
      audit.deletion_completed_at = Date.now();
    } catch (e) {
      audit.error = e.message || String(e);
      console.error(`[purge] ${uid} failed:`, e);
    }

    // Audit trail is keyed by completion timestamp + uid so it's easy to
    // bisect later. Failures are logged with error details so they can be
    // retried by hand.
    const auditKey = `${audit.deletion_completed_at || now}_${uid}`;
    try { await dbPatch(env, token, `/deletion_audit/${auditKey}`, audit); }
    catch (e) { console.error(`[purge] audit write failed for ${uid}:`, e); }

    results.push(audit);
  }

  return { processed: results.length, results };
}

// ──────────────────────────────────────────────────────────────────────────
// Worker entry points.
// ──────────────────────────────────────────────────────────────────────────

export default {
  // Scheduled cron handler — fires per the wrangler.toml `[triggers]`
  // schedule. Wrap the run in waitUntil so it's allowed to outlive the
  // immediate event ack.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPurge(env).then(
      r => console.log('[purge] scheduled run complete', JSON.stringify(r)),
      e => console.error('[purge] scheduled run failed', e)
    ));
  },

  // Fetch handler — only used for manual /run invocation behind a bearer
  // token. Useful for sanity-testing the same code path the cron uses.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run' || request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }
    const auth = request.headers.get('Authorization') || '';
    const expected = `Bearer ${env.PURGE_TRIGGER_TOKEN}`;
    if (!env.PURGE_TRIGGER_TOKEN || auth !== expected) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const result = await runPurge(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

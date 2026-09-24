# Hand-off to the app session: saved stories and reading history on the web

As built on 24 Sep 2026. It was verified from code and read-only production reads. Nothing here is proposed as built unless it says so.

## 1. Web saves are device-local. The app cannot read them.

```
IndexedDB database "cs-shelf", version 1, schemaV 1. NO server node.
Nothing is written to RTDB on save or remove (SaveForOffline.js, app/lib/shelf.js, shelfWorker.js).
Writer: the browser only (shelf.js saveStory/removeSaved). Signed-in readers only.

store "shelf"   keyPath "id", index "uid_kind" on [uid, kind]
  { id:"story:<slug>", kind:"story", slug, uid, schemaV:1,
    title, author, authorHandle, authorUid, category, categoryName, subcategory,
    date:string (display), content:string (HTML body as held on the page),
    cover:string, coverSizes:{w360,w720}|null, coverHash:string (blurhash),
    readingTime:number, savedAt:number (ms), coverBlobKey:"cover:<slug>:w360"|null, bytes:number }
store "assets"  keyPath "key"  { key, blob, type, bytes }   (w360 cover)
store "meta"    keyPath "k"    { k, v }

Cap (checked at save time only, never evicts): capFor('story', tier)
  free 2 · gold 20 · platinum unlimited  (a day or week pass counts as gold). Books are 0 on every tier.
Contract §6: a saved body stays readable for good and is never revalidated against /api/story.
```

## 2. Server-side data My Library › Stories could show today

| node | shape | rules (database.rules.json) | writer | notes |
|---|---|---|---|---|
| `users/{uid}/readStories/{slug}` | `true` | read: world (`users/$uid .read:true`, :193) · write: owner (:263) | web story page, engagement gate (`page-client.js:1210`) | 4,772 rows, 241 users. **No timestamp**, so it can't be ordered (SAVE-02). |
| `users/{uid}/readCount` | number | same | transaction +1 | |
| `storyReads/{slug}/{readerId}` | number (server ms, first qualified read) | see `database.rules.json`; carries an open privacy finding (SAVE-03, redacted in W1) | `/api/hit` with an admin token | Held off git until SAVE-03 is fixed. |
| `users/{uid}/readerProgress/{slug}` | `{fraction 0..1, updatedAt}` | world read · owner write (:266) | web reader, EPUB stories only | Every reader-mode story is unpublished now, so this node is effectively dead. 47 users. |
| `series_reading_progress/{uid}/{instalmentId}` | `{fraction, updatedAt, cfi?, epubVersion?}` | owner only; shape validated, `$other` rejected | web and app | 12 users. |
| `userProgress/{uid}/{slug}` | `{fraction, locator}` | owner only (:742) | **app** | The web never reads it. 26 users. |
| `userBookmarks/{uid}/{slug}/{locatorKey}` | `{chapterTitle, fraction, locator, savedAt}` | owner only (:748) | **app** | 4 users. |
| `bookmarks/{uid}/{slug}` | `{cfi, fraction}` | owner only (:701) | **app** | 7 users. |

- **"Recently read"** is `readStories` slugs, each looked up as `storyReads/{slug}/{uid}` for its time. That is one read per slug.
- **Prose reading position:** no server node holds one.

## 3. If cross-device saves are ruled in (SAVE-01). Proposal, NOT built.

```
saved_stories/{uid}/{slug}: { savedAt: number }     owner-only read and write, metadata only
```

The body still comes from `/api/story`, so a saved copy never becomes a second body store. It would be top-level rather than under `users/{uid}`, because `users/$uid` is world-readable and read rules cascade.

'use client';
// THE SERIES ADMIN.
//
// Every write goes through app/lib/series/admin-writes.js, which re-checks the admin UID and
// validates before it touches the database. This page is a form; it is not the authority, and
// the UID list below is a UI convenience — removing it would not let anyone write anything.
//
// ── WHAT THIS SCREEN IS CAREFUL ABOUT ────────────────────────────────────────────────────
//
// 1. releaseAtMs. The form takes a `datetime-local` value and converts it to EPOCH
//    MILLISECONDS before it goes anywhere near a record, because the release rule in
//    database.rules.json compares a NUMBER against the server clock and a date string there
//    would fail silently in whichever direction its digits sorted. The stored value is echoed
//    back beside the field as a plain integer so an editor can see what was written.
//
// 2. freeForGold is a real tri-state in the UI — unset / yes / no — and unset does not save.
//    A form that defaulted it to false would let an editor ship an instalment no Gold member
//    can open without ever having made that choice.
//
// 3. seriesId and ordinal are shown but not editable after creation. They are locked in
//    updateInstalment() for reasons that outlive this form (a reparented instalment carries
//    its ordinal, its release date and every reader's saved position into a run they do not
//    belong to), and a disabled input is the honest way to say so.
//
// 4. The EPUB uploader never asks for a URL and never shows one. The object is written to a
//    prefix that is `read: false` for every client including this one — see storage.rules —
//    so there is nothing to display and displaying it would be the bug.
//
// 5. R12.4 — THERE IS NO READING-TIME INPUT ON THIS SCREEN AND THERE MUST NOT BE ONE. The
//    figure is derived from the EPUB's own word count, taken by uploadInstalmentEpub() from
//    the same File it is uploading, because that is the only moment those words are reachable
//    (the object is `read: false` for this admin the instant it lands). It is shown here
//    read-only, beside the count it came from. A typed number would be wrong from the first
//    chapter revision onward and nothing in the record would say so; a derived one is wrong
//    only for as long as somebody has revised a chapter without re-uploading it, which is a
//    state this screen makes visible rather than hides.
//
// 6. The instalment's own COVER now has an uploader. It always had a field — createInstalment
//    has accepted coverUrl since R12.0 — but no form control was ever bound to it, so the only
//    art any instalment carried was whatever scripts/migrate-beta-princess.mjs copied across.
//    The instalment page's hero band is that cover, so the gap had to close.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { getAllSeries, getAllInstalments, getInstalmentDetail } from '../../lib/series/loader';
import {
  createSeries, updateSeries, setSeriesStatus,
  createInstalment, updateInstalment, setInstalmentStatus,
  uploadInstalmentEpub, uploadInstalmentImage, uploadSeriesImage,
  instalmentId as makeInstalmentId,
} from '../../lib/series/admin-writes';
import { isReleased, releasedCount } from '../../lib/series/access';
import { formatRelease, readingTimeLabel } from '../../lib/series/format';
import { SERIES_STATUSES, INSTALMENT_STATUSES } from '../../lib/series/schema';

const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body: { maxWidth: 1000, margin: '0 auto', padding: '2rem' },
  card: { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.25rem', marginBottom: '1.25rem' },
  h2: { fontSize: '1.2rem', fontWeight: 700, color: '#fff', margin: '0 0 0.75rem' },
  h3: { fontSize: '0.95rem', fontWeight: 700, color: '#e8e8e8', margin: '0 0 0.5rem' },
  label: { display: 'block', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.45)', marginBottom: 4, marginTop: 10 },
  input: { width: '100%', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 5, padding: '0.55rem 0.7rem', color: '#e8e8e8', fontFamily: 'inherit', fontSize: '0.9rem' },
  select: { width: '100%', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 5, padding: '0.55rem 0.7rem', color: '#e8e8e8', fontFamily: 'inherit', fontSize: '0.9rem' },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.6rem 1.3rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', marginTop: 12 },
  btnSm: { background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)', padding: '0.4rem 0.8rem', borderRadius: 5, fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' },
  row: { display: 'flex', gap: 12, alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid #222' },
  note: { fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  err: { color: '#f87171', fontSize: '0.8rem', marginTop: 8, whiteSpace: 'pre-wrap' },
  ok: { color: '#4ade80', fontSize: '0.8rem', marginTop: 8 },
};

/**
 * A `datetime-local` value → epoch ms, reading the typed time as UTC.
 *
 * THE `Z` IS THE WHOLE FUNCTION. `datetime-local` yields a zone-less string —
 * "2026-10-14T09:00" — and Date.parse() reads a zone-less datetime in the RUNTIME'S LOCAL
 * ZONE. An editor scheduling 09:00 from Lagos and one scheduling 09:00 from London would
 * write instants an hour apart, and the release rule compares against the RTDB server clock,
 * which is neither of them. Appending Z makes the typed time mean UTC, which is what the
 * field's label promises and what the rule will actually enforce.
 *
 * Seconds are normalised in rather than pattern-patched: browsers emit either "…T09:00" or
 * "…T09:00:00" depending on the step attribute, and both must land on the same instant.
 */
export function localInputToMs(value) {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(String(value));
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3] || '00'}Z`);
  return Number.isFinite(ms) ? ms : null;
}

export default function SeriesAdminPage() {
  const { user, loading } = useAuth() || {};
  const isAdmin = !!user && ADMIN_UIDS.includes(user.uid);

  const [list, setList] = useState([]);
  const [msg, setMsg] = useState(null);

  const refresh = useCallback(async () => {
    // getAllSeries, not getPublishedSeries: a series is created as a DRAFT and would be
    // invisible on the screen that just created it otherwise.
    const all = await getAllSeries();
    const withRows = await Promise.all(all.map(async (x) => ({ ...x, rows: await getAllInstalments(x.id) })));
    setList(withRows);
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    (async () => { if (!cancelled) await refresh(); })();
    return () => { cancelled = true; };
  }, [isAdmin, refresh]);

  if (loading) return <div style={s.page}><div style={s.body}>Loading…</div></div>;
  if (!isAdmin) {
    return (
      <div style={s.page}>
        <div style={{ ...s.body, textAlign: 'center', paddingTop: '5rem' }}>
          <div style={{ fontSize: '1.1rem', color: '#f87171', fontWeight: 700 }}>Not authorised</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.logo}>Calvary Scribblings</div>
        <div style={s.sub}>The Series — instalments</div>
      </header>
      <div style={s.body}>
        {msg && <div style={msg.ok ? s.ok : s.err}>{msg.text}</div>}

        <SeriesForm onDone={(m) => { setMsg(m); refresh(); }} />

        {list.map((series) => (
          <div key={series.id} style={s.card}>
            <h2 style={s.h2}>{series.title}</h2>
            <div style={s.note}>
              {series.id} · {series.status} · {releasedCount(series.rows)} of {series.rows.length} instalments released
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SERIES_STATUSES.filter((st) => st !== series.status).map((st) => (
                <button key={st} type="button" style={s.btnSm}
                  onClick={async () => { setMsg(toMsg(await setSeriesStatus(series.id, st))); refresh(); }}>
                  Set {st}
                </button>
              ))}
              <PosterUpload seriesId={series.id} onDone={(m) => { setMsg(m); refresh(); }} />
            </div>

            <h3 style={{ ...s.h3, marginTop: 18 }}>Instalments</h3>
            {series.rows.map((row) => (
              <InstalmentRow key={row.id} row={row} onDone={(m) => { setMsg(m); refresh(); }} />
            ))}
            {!series.rows.length && <div style={s.note}>None yet.</div>}

            <InstalmentForm
              seriesId={series.id}
              nextOrdinal={(series.rows.reduce((n, r) => Math.max(n, r.ordinal || 0), 0)) + 1}
              onDone={(m) => { setMsg(m); refresh(); }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const toMsg = (r) => (r?.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: (r?.errors || ['Unknown error']).join('\n') });

function SeriesForm({ onDone }) {
  const [f, setF] = useState({ title: '', synopsis: '', coverUrl: '' });
  return (
    <div style={s.card}>
      <h2 style={s.h2}>New series</h2>
      <label style={s.label}>Title</label>
      <input style={s.input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label style={s.label}>Synopsis</label>
      <textarea style={{ ...s.input, minHeight: 70 }} value={f.synopsis} onChange={(e) => setF({ ...f, synopsis: e.target.value })} />
      <label style={s.label}>Poster URL</label>
      <input style={s.input} value={f.coverUrl} onChange={(e) => setF({ ...f, coverUrl: e.target.value })} />
      <div style={s.note}>
        The poster is the series&apos; own art, distinct from any instalment&apos;s cover. Required to publish.
        Upload one with the button on an existing series, or paste a URL here.
      </div>
      <button type="button" style={s.btn}
        onClick={async () => {
          const r = await createSeries({ ...f, coverUrl: f.coverUrl || null, status: 'draft' });
          onDone(toMsg(r));
          if (r.ok) setF({ title: '', synopsis: '', coverUrl: '' });
        }}>
        Create (as draft)
      </button>
    </div>
  );
}

function PosterUpload({ seriesId, onDone }) {
  const [busy, setBusy] = useState(false);
  return (
    <label style={{ ...s.btnSm, display: 'inline-block' }}>
      {busy ? 'Uploading…' : 'Upload poster'}
      <input
        type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          const up = await uploadSeriesImage(seriesId, file);
          const r = up.ok ? await updateSeries(seriesId, { coverUrl: up.url }) : up;
          setBusy(false);
          onDone(toMsg(r));
        }}
      />
    </label>
  );
}

function InstalmentRow({ row, onDone }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const released = isReleased(row);

  // Its own reload rather than the page's refresh(): refresh() re-reads the SERIES and its
  // rows, and the detail record hangs off this component's own effect, keyed on an id that has
  // not changed. Saving a logline and seeing the old one is how an editor concludes the save
  // failed and types it again.
  const reload = useCallback(async () => setDetail(await getInstalmentDetail(row.id)), [row.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await getInstalmentDetail(row.id);
      if (!cancelled) setDetail(d);
    })();
    return () => { cancelled = true; };
  }, [row.id]);

  return (
    <div style={{ borderBottom: '1px solid #222' }}>
      <div style={{ ...s.row, borderBottom: 'none' }}>
        <span style={{ minWidth: 28, color: '#c9a84c' }}>{row.ordinal}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          {/* The detail node is admin-readable at any time, so a title shows here even before
              release — the deny-until-release rule carves out the two admin UIDs precisely so
              this screen can work. A reader would see nothing. */}
          <div>{detail?.title || <em style={{ color: 'rgba(255,255,255,0.35)' }}>(detail unreadable)</em>}</div>
          <div style={s.note}>
            {row.id} · {row.status} · {released ? 'RELEASED' : `arrives ${formatRelease(row.releaseAtMs) || '—'}`}
            {' · '}releaseAtMs {row.releaseAtMs}
            {' · '}{row.freeForGold ? 'free for Gold' : 'Platinum only'}
          </div>
          <div style={s.note}>
            {/* Everything on this line is behind the release rule for a reader. It shows here
                because the rule carves out the admin UIDs, not because any of it is public. */}
            cover {detail?.coverUrl ? '✓' : '—'}
            {' · '}logline {detail?.logline ? '✓' : '—'}
            {' · '}sponsor {detail?.sponsorName || '—'}{detail?.sponsorLogoUrl ? ' (logo ✓)' : ''}
            {' · '}{detail?.wordCount
              ? `${detail.wordCount.toLocaleString('en-GB')} words → ${readingTimeLabel(detail.wordCount)}`
              : 'not counted — upload an EPUB'}
          </div>
        </span>
        <label style={{ ...s.btnSm, display: 'inline-block' }}>
          {busy ? 'Uploading…' : 'EPUB'}
          <input
            type="file" accept=".epub,application/epub+zip" style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              const up = await uploadInstalmentEpub(row.id, file);
              // wordCount travels WITH epubPath, in one write, because they describe the same
              // bytes. Writing the path and leaving the old count would put a confident
              // reading time on the page for a file that is no longer there.
              const r = up.ok ? await updateInstalment(row.id, { epubPath: up.epubPath, wordCount: up.wordCount }) : up;
              setBusy(false);
              await reload();
              onDone(r.ok && up.warnings?.length
                ? { ok: true, text: `Saved. ${up.warnings.join(' ')}` }
                : toMsg(r));
            }}
          />
        </label>
        <button type="button" style={s.btnSm} onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close' : 'Edit'}
        </button>
        {INSTALMENT_STATUSES.filter((st) => st !== row.status).map((st) => (
          <button key={st} type="button" style={s.btnSm}
            onClick={async () => onDone(toMsg(await setInstalmentStatus(row.id, st)))}>
            {st}
          </button>
        ))}
      </div>
      {editing && (detail
        ? (
          // key={detail.updatedAt} rather than a syncing effect: the form seeds itself from
          // the record in its state initialiser, and a save — which bumps updatedAt — remounts
          // it against what was actually stored. An effect that pushed the record into the
          // form would fight the editor's own typing on every reload.
          <InstalmentDetailEditor
            key={detail.updatedAt}
            row={row}
            detail={detail}
            onSaved={async (m) => { await reload(); onDone(m); }}
          />
        )
        : <div style={{ ...s.note, padding: '0.5rem 0 1rem 40px' }}>Detail record still loading, or unreadable.</div>
      )}
    </div>
  );
}

/**
 * The instalment page's own fields, editable after creation.
 *
 * SEPARATE FROM InstalmentForm ON PURPOSE. That form creates; this one edits, and the two live
 * instalments predate every field on this panel — a create-only form would have left
 * beta-princess i1 and i2 permanently without a logline or a sponsor, reachable only by a
 * script. Everything here goes through updateInstalment(), which re-validates the whole merged
 * detail record and writes the row and the detail as one atomic update.
 *
 * '' → null on save, never stored as an empty string. validateInstalmentDetail() rejects '',
 * for the reason the bookstore's v1→v2 asset migration exists: an empty string is falsy
 * everywhere it is tested and truthy where it is rendered, so it shows as a populated field in
 * an admin and a blank italic line on the page.
 */
function InstalmentDetailEditor({ row, detail, onSaved }) {
  // Seeded once, in the initialiser. The caller remounts this component on every saved change
  // (see its key) so "seed once" and "always show what is stored" are the same thing here.
  const [f, setF] = useState({ logline: detail.logline || '', sponsorName: detail.sponsorName || '' });
  const [busy, setBusy] = useState(null);

  // What the editor has TYPED, which is what every control below reads. The saved value is
  // only ever a seed for it — see the sponsor uploader for why that distinction was a bug.
  const sponsorName = f.sponsorName.trim();

  /**
   * Upload an image and record it. `patchFor` builds the whole record patch from the returned
   * URL, rather than this taking a single field name, because the sponsor logo has to write
   * TWO fields and the cover writes one. One `updateInstalment` call either way — it applies a
   * multi-path RTDB update, so everything in the patch lands atomically or none of it does.
   */
  const upload = async (kind, file, patchFor) => {
    setBusy(kind);
    const up = await uploadInstalmentImage(row.id, kind, file);
    const r = up.ok ? await updateInstalment(row.id, patchFor(up.url)) : up;
    setBusy(null);
    onSaved(toMsg(r));
  };

  return (
    <div style={{ padding: '0.75rem 0 1.1rem 40px' }}>
      <label style={s.label}>Logline</label>
      <input
        style={s.input} value={f.logline}
        onChange={(e) => setF({ ...f, logline: e.target.value })}
        placeholder="One sentence, plain text."
      />
      <div style={s.note}>
        Rendered alone and in italic directly under the title. Plain text — it is set in the
        page&apos;s own type and carries no markup.
      </div>

      <label style={s.label}>Sponsor name</label>
      <input
        style={s.input} value={f.sponsorName}
        onChange={(e) => setF({ ...f, sponsorName: e.target.value })}
        placeholder="Leave empty for no sponsor credit."
      />
      <div style={s.note}>
        A name with no logo is fine — the credit renders as two lines with no tile. A logo with
        no name is refused: it would sit over a blank second line and read as a fault.
      </div>

      <button type="button" style={s.btn}
        onClick={async () => {
          setBusy('save');
          const r = await updateInstalment(row.id, {
            logline: f.logline.trim() || null,
            sponsorName: f.sponsorName.trim() || null,
            // Clearing the NAME clears the LOGO with it, in the same write. Otherwise the
            // record would hold a logo with no name, which the validator refuses — the save
            // would fail with an error about a field the editor did not touch.
            ...(f.sponsorName.trim() ? {} : { sponsorLogoUrl: null }),
          });
          setBusy(null);
          onSaved(toMsg(r));
        }}>
        {busy === 'save' ? 'Saving…' : 'Save logline & sponsor'}
      </button>

      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ ...s.btnSm, display: 'inline-block' }}>
          {busy === 'cover' ? 'Uploading…' : 'Upload instalment cover'}
          <input
            type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const file = e.target.files?.[0]; if (file) upload('cover', file, (url) => ({ coverUrl: url })); }}
          />
        </label>

        {/* ── THE SPONSOR LOGO, AND THE BUG THAT WAS HERE ────────────────────────────────
            It shipped gated on the SAVED name (`detail.sponsorName`), so an editor who typed
            a sponsor's name and reached for the logo button got a dead control: the input was
            disabled, and a <label> wrapping a disabled input is inert — no file picker opens,
            not even on a forced click. Every live instalment had an empty sponsorName, so the
            button was dead on all of them. Reported from the outside as "it isn't working",
            which is exactly what it looked like.

            The reasoning behind the gate was half-right: updateInstalment merges the patch
            into the STORED record and re-validates, and validateInstalmentDetail refuses a
            sponsorLogoUrl with no sponsorName — so writing the URL alone against an unsaved
            name really would have uploaded the file and then failed the write.

            The answer to that is not to disable the button. It is to write the NAME AND THE
            URL TOGETHER, in the one atomic update they always belonged in — the same argument
            epubPath and wordCount are written by. Then the validator is satisfied by the same
            write that could have violated it, the control gates on what the editor can see
            themselves typing, and there is no save-first ritual to know about. */}
        <label style={{
          ...s.btnSm, display: 'inline-block',
          opacity: sponsorName ? 1 : 0.45,
          cursor: sponsorName ? 'pointer' : 'default',
        }}>
          {busy === 'sponsor'
            ? 'Uploading…'
            : (sponsorName ? 'Upload sponsor logo' : 'Add a sponsor name first')}
          <input
            type="file" accept="image/*" style={{ display: 'none' }}
            disabled={!sponsorName}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload('sponsor', file, (url) => ({ sponsorName, sponsorLogoUrl: url }));
            }}
          />
        </label>
      </div>
      <div style={s.note}>
        Both go to series_covers/{row.id}/… — public-read objects with unguessable URLs, exactly
        as the series poster already is. What keeps an unreleased instalment&apos;s cover and
        sponsor hidden is that the URLs naming them live on the detail record, which the release
        rule denies. The logo upload saves the sponsor name with it, in one write — there is no
        need to press Save first.
      </div>
    </div>
  );
}

function InstalmentForm({ seriesId, nextOrdinal, onDone }) {
  const blank = {
    ordinal: nextOrdinal, title: '', synopsis: '', logline: '', author: '', authorUid: '',
    authorHandle: '', sponsorName: '', coverUrl: '', release: '', freeForGold: '',
  };
  const [f, setF] = useState(blank);

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #242424' }}>
      <h3 style={s.h3}>Add instalment — {makeInstalmentId(seriesId, f.ordinal)}</h3>
      <label style={s.label}>Ordinal</label>
      <input style={s.input} type="number" min="1" value={f.ordinal}
        onChange={(e) => setF({ ...f, ordinal: Number(e.target.value) })} />
      <label style={s.label}>Title</label>
      <input style={s.input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label style={s.label}>Synopsis (optional)</label>
      <input style={s.input} value={f.synopsis} onChange={(e) => setF({ ...f, synopsis: e.target.value })} />
      <label style={s.label}>Logline (optional)</label>
      <input style={s.input} value={f.logline} onChange={(e) => setF({ ...f, logline: e.target.value })}
        placeholder="One sentence, plain text." />
      <div style={s.note}>
        Distinct from the synopsis: the logline is the one italic line under the title on the
        instalment page. Editable afterwards from this row&apos;s Edit panel.
      </div>
      <label style={s.label}>Author name / uid / handle</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={s.input} placeholder="name" value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} />
        <input style={s.input} placeholder="authorUid" value={f.authorUid} onChange={(e) => setF({ ...f, authorUid: e.target.value })} />
        <input style={s.input} placeholder="handle" value={f.authorHandle} onChange={(e) => setF({ ...f, authorHandle: e.target.value })} />
      </div>
      <div style={s.note}>
        All three are required. Without authorUid the instalment is invisible to Voices, search
        and the app&apos;s myStories list. `name` is what the instalment page prints as
        &ldquo;written by&rdquo; — there is no separate writer field and there should not be
        one, or a page would eventually credit somebody the record does not.
      </div>
      <label style={s.label}>Sponsor name (optional)</label>
      <input style={s.input} value={f.sponsorName} onChange={(e) => setF({ ...f, sponsorName: e.target.value })} />
      <div style={s.note}>
        The logo is uploaded from this row&apos;s Edit panel once the instalment exists — the
        object key is derived from its id, which does not exist until it is created.
      </div>

      <label style={s.label}>Release (UTC)</label>
      <input style={s.input} type="datetime-local" value={f.release} onChange={(e) => setF({ ...f, release: e.target.value })} />
      <div style={s.note}>
        Stored as releaseAtMs = {localInputToMs(f.release) ?? '—'} (epoch ms, UTC). Nobody — Free,
        Gold or Platinum — can open the file before this instant.
      </div>

      <label style={s.label}>Free for Gold</label>
      <select style={s.select} value={f.freeForGold} onChange={(e) => setF({ ...f, freeForGold: e.target.value })}>
        <option value="">— choose —</option>
        <option value="yes">Yes — Gold members may read this one</option>
        <option value="no">No — Platinum only</option>
      </select>
      <div style={s.note}>
        No default. An unchosen value will not save. This is not tied to ordinal 1 — any
        instalment may be the Gold taste, and a series may have more than one or none.
        Day and week passes never qualify, whichever way this is set.
      </div>

      <button type="button" style={s.btn}
        onClick={async () => {
          const r = await createInstalment({
            seriesId,
            ordinal: f.ordinal,
            title: f.title,
            synopsis: f.synopsis || null,
            logline: f.logline.trim() || null,
            author: f.author,
            authorUid: f.authorUid,
            authorHandle: f.authorHandle,
            sponsorName: f.sponsorName.trim() || null,
            coverUrl: f.coverUrl || null,
            releaseAtMs: localInputToMs(f.release),
            // '' stays undefined so the validator rejects it rather than defaulting to false.
            freeForGold: f.freeForGold === 'yes' ? true : (f.freeForGold === 'no' ? false : undefined),
            status: 'draft',
          });
          onDone(toMsg(r));
          if (r.ok) setF({ ...blank, ordinal: f.ordinal + 1 });
        }}>
        Create (as draft)
      </button>
    </div>
  );
}

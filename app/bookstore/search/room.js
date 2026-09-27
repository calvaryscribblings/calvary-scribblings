'use client';
// THE SEARCH ROOM — W22 §6, drawn from the canvas "Book Store rooms".
//
// THE CORPUS is the titles the storefront shows, under the same visibility, territory and
// withdrawal rules — it is getAllPublishedTitles(), the storefront's own read, and nothing else.
// A title matches on its title, its byline (author), its authorName and its genre's shop label,
// case- and accent-insensitively, through the site's ONE normaliser (app/lib/searchIndex.js).
//
// THE QUERY LIVES IN ?q=, written with replaceState while typing, so Back leaves the room rather
// than stepping back through every letter.
//
// Groups, in order: AUTHOR (each distinct matching name), GENRE (each matching shop label), and
// TITLES (the Desiderata row without BUY or the disc). Matches are gold throughout.

import { useMemo, useRef, useState } from 'react';
import RoomFrame from '../components/RoomFrame';
import { RoomRow, ROOM_ROW_CSS, Lit } from '../components/RoomRow';
import { Magnifier } from '../components/Desiderata';
import Unavailable from '../../components/Unavailable';
import { useReliableLoad } from '../../lib/useReliable';
import { getAllPublishedTitles, getGenres } from '../../lib/bookstore/loader';
import { genreLabel as labelOf } from '../../lib/bookstore/genres';
import { searchShelves } from '../../lib/bookstore/shelfSearch';
import { DESIDERATA_COPY as COPY } from '../../lib/bookstore/desiderata';

export default function SearchRoom() {
  return (
    <RoomFrame room="Search" css={`${ROOM_ROW_CSS}${SEARCH_CSS}`}>
      <ShelfSearch />
    </RoomFrame>
  );
}

function readQuery() {
  try { return new URLSearchParams(window.location.search).get('q') || ''; } catch { return ''; }
}

function writeQuery(q) {
  try {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch { /* the URL is a convenience; the room works without it */ }
}

function ShelfSearch() {
  // Mounted only on the client, behind the curtain (RoomFrame renders nothing before the key is
  // read), so reading the location during the first render is not a hydration hazard here.
  const [query, setQuery] = useState(readQuery);
  const input = useRef(null);
  const shelf = useReliableLoad(async () => {
    const [titles, genres] = await Promise.all([getAllPublishedTitles({ throwOnError: true }), getGenres()]);
    return { titles, genres };
  }, []);

  const set = (q) => { setQuery(q); writeQuery(q); };
  const labelFor = (slug) => labelOf(shelf.data?.genres || [], slug);
  const results = useMemo(
    () => (shelf.data ? searchShelves(shelf.data.titles, (s) => labelOf(shelf.data.genres, s), query) : null),
    [shelf.data, query],
  );
  const typed = query.trim().length > 0;
  const none = results && typed && !results.authors.length && !results.genres.length && !results.titles.length;

  return (
    <>
      <div className="sr-field">
        <label htmlFor="sr-q" className="room-sr">{COPY.searchLabel}</label>
        <span className="sr-glass"><Magnifier size={18} width={1.75} /></span>
        <input
          id="sr-q" ref={input} type="search" className="sr-input" data-field-large
          value={query} onChange={(e) => set(e.target.value)}
          autoFocus autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
          data-testid="search-input"
        />
        {query && (
          <button type="button" className="sr-clear" aria-label="Clear the search" data-testid="search-clear"
            onClick={() => { set(''); input.current?.focus(); }}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path d="M1 1 L9 9 M9 1 L1 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {!typed && <p className="sr-hint">{COPY.searchHint}</p>}

      {shelf.phase === 'failed' && (
        <Unavailable kind={shelf.failure} onRetry={shelf.retry} refreshing={shelf.refreshing} subject="the shelves" />
      )}

      {none && <p className="sr-none" data-testid="search-none">{COPY.noResults(query.trim())}</p>}

      {results && typed && results.authors.length > 0 && (
        <section className="sr-group" data-testid="search-authors">
          <div className="sr-kicker">Author</div>
          {results.authors.map((name) => (
            <div className="sr-name-row" key={name}>
              <span className="sr-name"><Lit text={name} query={query} /></span>
              <button type="button" className="sr-all" onClick={() => set(name)}>All titles &rsaquo;</button>
            </div>
          ))}
        </section>
      )}

      {results && typed && results.genres.length > 0 && (
        <section className="sr-group" data-testid="search-genres">
          <div className="sr-kicker">Genre</div>
          {results.genres.map((label) => (
            <div className="sr-name-row" key={label}>
              <span className="sr-name"><Lit text={label} query={query} /></span>
              <button type="button" className="sr-all" onClick={() => set(label)}>All titles &rsaquo;</button>
            </div>
          ))}
        </section>
      )}

      {results && typed && results.titles.length > 0 && (
        <section className="sr-group" data-testid="search-titles">
          <div className="sr-kicker">Titles</div>
          <div className="sr-list">
            {results.titles.map((t) => (
              <RoomRow key={t.id} title={t} genre={labelFor(t.genre)} query={query} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ⚠ Template literal: no backticks in these comments.
const SEARCH_CSS = `
  /* The field, as drawn: a gold .45 hairline under it, the magnifier at its left with 12px to the
     text, Cormorant 22px in cream .92 with a gold caret, 44px tall. 30px under the breadcrumb, as
     the Desiderata head is. */
  .sr-field{position:relative;display:flex;align-items:center;gap:12px;margin-top:30px;border-bottom:1px solid rgba(201,164,76,.45)}
  .sr-glass{display:flex;color:#c9a44c;flex:none}
  .sr-input{flex:1;min-width:0;height:44px;padding:0;margin:0;border:0;outline:none;background:none;border-radius:0;
    font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;color:rgba(240,234,216,.92);caret-color:#c9a44c;
    -webkit-appearance:none;appearance:none}
  .sr-input::-webkit-search-cancel-button,.sr-input::-webkit-search-decoration{-webkit-appearance:none;appearance:none}
  .sr-field:focus-within{border-bottom-color:rgba(201,164,76,.8)}
  /* The clear button: a 10px cross in cream .55, its target 44px. */
  .sr-clear{position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:10px;height:10px;padding:0;margin:0 6px 0 0;
    border:0;background:none;color:rgba(240,234,216,.55);cursor:pointer}
  .sr-clear::before{content:'';position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%)}
  .sr-clear:focus-visible{outline:2px solid #c9a44c;outline-offset:6px;border-radius:2px}
  .sr-hint{margin:14px 0 0;font-style:italic;font-size:14px;color:rgba(240,234,216,.5)}
  .sr-none{margin:24px 0 0;font-style:italic;font-size:16px;line-height:22px;color:rgba(240,234,216,.5)}
  /* Groups. The kicker takes the row kicker's type, in gold .6. The 28px above each group and
     the 10px under its kicker are CHOSEN. */
  .sr-group{margin-top:28px}
  .sr-kicker{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,164,76,.6);margin-bottom:10px}
  .sr-list{border-top:1px solid rgba(201,164,76,.14)}
  /* AUTHOR and GENRE rows: 48px, the name 25px/29px at 641 and up, 21px/24px on a phone (CHOSEN,
     in proportion); ALL TITLES at the right in the kicker's type, in gold .8. */
  .sr-name-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:48px;
    border-bottom:1px solid rgba(201,164,76,.1)}
  .sr-kicker + .sr-name-row{border-top:1px solid rgba(201,164,76,.14)}
  .sr-name{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:25px;line-height:29px;color:rgba(240,234,216,.92);min-width:0}
  .sr-all{position:relative;flex:none;padding:0;border:0;background:none;cursor:pointer;
    font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,164,76,.8)}
  .sr-all::before{content:'';position:absolute;left:-8px;right:-8px;top:50%;height:44px;transform:translateY(-50%)}
  .sr-all:hover{color:#c9a44c}
  @media(max-width:640px){
    .sr-name{font-size:21px;line-height:24px}
    /* TITLES on a phone: a 50px book, 104px rows, 16px gap, kicker 7.5px, title 18/21, author 14/17. */
    .sr-list .rr-row{--rr-book:50px;min-height:104px;column-gap:16px;grid-template-areas:"book text";grid-template-rows:auto}
    .sr-list .rr-kicker{font-size:7.5px}
    .sr-list .rr-title{font-size:18px;line-height:21px}
    .sr-list .rr-author{font-size:14px;line-height:17px}
  }
`;

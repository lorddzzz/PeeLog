// The single writer. Screens never touch localStorage (DESIGN.md §9), so a
// sync layer can slot in later behind get / update / subscribe.

import { emptyDoc, migrate } from './model.js';

// Re-exported because they answer "which night does this tap belong to?", and
// every caller of that question already holds the store.
export { activeNightFor, openNight } from './model.js';

export const STORE_KEY = 'peelog:v1';

export function createStore(storage = localStorage, key = STORE_KEY) {
  const subs = new Set();
  let doc = emptyDoc();
  let loadIssue = null;

  // A private-browsing window throws on access, not just on write.
  const read = k => { try { return storage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { storage.setItem(k, v); } catch { /* best effort */ } };

  const raw = read(key);
  if (raw !== null && raw !== undefined) {
    // Last session's document, kept beside the live one: a bad deploy that
    // corrupts today's writes still has something to go back to. Once per boot.
    write(`${key}:prev`, raw);

    let parsed = null;
    let parsedOk = true;
    try { parsed = JSON.parse(raw); } catch { parsedOk = false; }

    if (!parsedOk) {
      // Never drop something we could not read — park the raw text next to it.
      loadIssue = 'corrupt';
      write(`${key}:corrupt`, raw);
    } else {
      const m = migrate(parsed);
      if (m.ok) doc = m.doc;
      else {
        // Written by a later build on this device. Starting empty would
        // overwrite it on the first tap, so keep a copy before that happens.
        loadIssue = m.reason;
        write(`${key}:newer`, raw);
      }
    }
  }

  function commit(next) {
    try {
      storage.setItem(key, JSON.stringify(next));
    } catch (error) {
      // Quota or private mode: the in-memory document is untouched and the
      // caller shows the S01 "Not saved" state. Nothing says Saved before this
      // returns ok.
      return { ok: false, error };
    }
    doc = next;
    for (const fn of [...subs]) fn(doc);
    return { ok: true };
  }

  function update(fn) {
    let draft;
    try {
      draft = structuredClone(doc);
      fn(draft);
    } catch (error) {
      return { ok: false, error };
    }
    return commit(draft);
  }

  // Whole-document swap for restore; same write path, same failure contract.
  function replace(next) {
    let copy;
    try { copy = structuredClone(next); } catch (error) { return { ok: false, error }; }
    return commit(copy);
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  return { key, loadIssue, get: () => doc, update, replace, subscribe };
}

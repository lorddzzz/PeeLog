// B01–B07 and O01/O03: making a separate copy, reading one back, and the CSV
// export. Two rules run through the whole file:
//
//   1. Preparing a file is not saving one. A share sheet that opened is not a
//      verified copy, so the confirmed-backup timestamp is only written after
//      the parent says they saved it (UX-HANDOFF B01).
//   2. Nothing about a restore touches the live document until the preview is
//      confirmed, and then it lands as one whole-document write or not at all
//      (B03/B05). A parse failure never puts the file's contents on screen.

import { lastCompletedNightId } from './metrics.js';
import {
  applyRestore, csvFileName, csvRows, csvText, dayLabelFor, daysSince,
  exportFileName, isReviewed, readBackup, restorePlan, shiftDate,
  stampLabelFor, toIso,
} from './model.js';
import { button, h, linkRow, notice, paint, savedStrip, title } from './ui.js';

export const OVERDUE_DAYS = 10;

/* ── Delivery ───────────────────────────────────────────────────────────
   The share sheet where it exists, a download where it does not. Neither
   can tell us the file was actually kept: `shared` and `downloaded` both
   mean "handed over", which is why the caller still has to ask. */

export async function deliver({ text, name, type }) {
  const file = new File([text], name, { type });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return { ok: true, how: 'shared' };
    } catch (err) {
      // A cancelled share is not a failure and must not move any timestamp.
      if (err?.name === 'AbortError') return { ok: false, cancelled: true };
      return { ok: false, error: err };
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    // Revoking in the same task can cancel the download that click just
    // started (Safari): give the navigation a turn of the event loop first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { ok: true, how: 'downloaded' };
  } catch (err) {
    return { ok: false, error: err };
  }
}

const NOT_VERIFIED = 'A share sheet that opened is not a verified copy. '
  + 'Check the file is where you expect it before answering.';

function nightCounts(doc) {
  const total = doc.nights.length;
  const reviewed = doc.nights.filter(isReviewed).length;
  return { total, reviewed, incomplete: total - reviewed };
}

// 'No backup yet' / '11 days ago'. Used here and by More's row.
export function backupAgeLabel(settings, now) {
  const confirmed = settings?.lastBackupConfirmedAt ?? null;
  const days = daysSince(confirmed, now);
  if (days === null) return { text: 'No backup yet', days: null, overdue: true };
  return {
    text: days === 0 ? 'Backed up today' : `${days} day${days === 1 ? '' : 's'} ago`,
    days,
    overdue: days > OVERDUE_DAYS,
  };
}

/* ── B01 · Backup ───────────────────────────────────────────────────── */

const backup = { phase: 'idle', name: '', later: false, confirmed: false, error: '' };

function resetBackup() {
  backup.phase = 'idle';
  backup.name = '';
  backup.later = false;
  backup.confirmed = false;
  backup.error = '';
}

export function renderBackup(el, ctx) {
  resetBackup();
  const redraw = () => paint(el, backupScreen(ctx, redraw));
  redraw();
  return ctx.store.subscribe(redraw);
}

function backupScreen(ctx, redraw) {
  const doc = ctx.store.get();
  const counts = nightCounts(doc);
  if (backup.phase !== 'idle') return preparedScreen(ctx, counts, redraw);

  const age = backupAgeLabel(doc.settings, ctx.now());
  const last = doc.settings.lastBackupConfirmedAt ?? doc.settings.lastBackupAt ?? null;

  return [
    title({
      overline: 'Backup & restore',
      name: 'A separate copy',
      lead: 'Keep your nights somewhere safe.',
    }),
    h('img', { class: 'art', src: 'assets/art/bedside-notebook.jpg', alt: '' }),
    backup.confirmed
      ? savedStrip({ text: 'Backup confirmed', detail: 'Saved somewhere safe' })
      : null,
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'Last exported backup' }),
      h('div', { class: `field-value${last ? '' : ' empty'}`, text: last ? stampLabelFor(last) : 'No backup yet' }),
      doc.settings.lastBackupConfirmedAt
        ? null
        : h('p', { class: 'field-help', text: 'No copy has been confirmed as saved on this phone.' })),
    // Overdue, not a nag: it appears here and after the morning outcome, and
    // never on the nighttime action grid (M01).
    counts.total && age.overdue && !backup.later
      ? notice({
        kind: 'warm',
        title: age.days === null
          ? 'No backup yet.'
          : `It’s been ${age.days} days since your last backup.`,
        text: `${counts.total} recorded night${counts.total === 1 ? '' : 's'} live only on this phone.`,
        children: [
          button({ label: 'Back up now', k: 'now', onClick: () => prepare(redraw, ctx) }),
          button({ label: 'Later', kind: 'quiet', k: 'later', onClick: () => { backup.later = true; redraw(); } }),
        ],
      })
      : null,
    button({
      label: 'Create backup', kind: 'primary', icon: 'backup', k: 'create',
      onClick: () => prepare(redraw, ctx),
    }),
    linkRow({ label: 'Restore from a backup', href: '#/more/restore', k: 'restore' }),
    h('p', { class: 'small', text: 'Save the file somewhere you can find again, such as Files. '
      + 'A backup is separate from the records on this phone, and the whole log goes into it.' }),
  ];
}

function prepare(redraw, ctx) {
  backup.name = exportFileName(ctx.now());
  backup.phase = 'prepared';
  backup.error = '';
  redraw();
}

function preparedScreen(ctx, counts, redraw) {
  const cancelled = backup.phase === 'cancelled';
  const failed = backup.phase === 'failed';
  const delivered = backup.phase === 'delivered';

  return [
    title({ overline: 'All recorded nights', name: failed ? 'No backup created' : 'Backup prepared' }),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'File' }),
      h('div', { class: 'field-value', text: backup.name })),
    h('p', { class: 'lead', text: `${counts.reviewed} reviewed night${counts.reviewed === 1 ? '' : 's'} `
      + `and ${counts.incomplete} incomplete record${counts.incomplete === 1 ? '' : 's'}.` }),
    failed
      ? notice({ kind: 'error', title: 'No backup was created. Try again.', text: 'Your records are unchanged.' })
      : null,
    // The write that records "yes, I saved it" can fail like any other (S01):
    // say so here rather than leaving the tap looking ignored.
    backup.error
      ? notice({
        kind: 'error',
        title: backup.error,
        text: 'The backup date on this phone has not moved. The file you saved is still fine.',
      })
      : null,
    cancelled
      ? notice({
        title: 'No new backup confirmed.',
        text: 'Your records are still on this phone, and the last backup date has not changed.',
      })
      : null,
    delivered
      ? notice({
        title: 'Saved it somewhere safe?',
        text: NOT_VERIFIED,
        children: [
          button({ label: 'Yes, I saved it', k: 'saved-yes', onClick: () => confirmSaved(ctx, redraw) }),
          button({ label: 'Not yet', kind: 'quiet', k: 'saved-no', onClick: () => { resetBackup(); redraw(); } }),
        ],
      })
      : button({
        label: cancelled || failed ? 'Try again' : 'Save or share file',
        kind: 'primary', icon: 'share', k: 'send',
        onClick: () => send(ctx, redraw),
      }),
    button({ label: 'Back to backup', kind: 'quiet', k: 'back', onClick: () => { resetBackup(); redraw(); } }),
  ];
}

async function send(ctx, redraw) {
  const text = JSON.stringify(ctx.store.get(), null, 2);
  const result = await deliver({ text, name: backup.name, type: 'application/json' });
  if (result.cancelled) { backup.phase = 'cancelled'; redraw(); return; }
  if (!result.ok) { backup.phase = 'failed'; redraw(); return; }
  // A file was handed over — that much is true, so the prepared timestamp
  // moves. Whether it was kept is the next question, and only that answer
  // moves lastBackupConfirmedAt.
  ctx.store.update(d => { d.settings.lastBackupAt = toIso(ctx.now()); });
  backup.phase = 'delivered';
  redraw();
}

function confirmSaved(ctx, redraw) {
  const result = ctx.store.update(d => {
    d.settings.lastBackupConfirmedAt = toIso(ctx.now());
    if (!d.settings.lastBackupAt) d.settings.lastBackupAt = d.settings.lastBackupConfirmedAt;
  });
  if (!result.ok) { backup.error = 'Not saved'; redraw(); return; }
  resetBackup();
  backup.confirmed = true;
  redraw();
}

/* ── B02–B07 · Restore ──────────────────────────────────────────────────
   Read, preview, confirm, apply — in that order, with the live document
   untouched until the last step. */

const restore = {
  phase: 'choose', text: '', doc: null, plan: null, mode: 'add',
  error: '', result: null, keep: false,
};

function resetRestore() {
  restore.phase = 'choose';
  restore.text = '';
  restore.doc = null;
  restore.plan = null;
  restore.mode = 'add';
  restore.error = '';
  restore.result = null;
}

// The chosen file survives the round trip to Backup (B05) and nothing else:
// the router calls this on every navigation, so coming back to Restore days
// later opens on the file picker, not on someone else's half-finished replace.
export function onRouteChange(hash) {
  if (hash === '#/more/backup' || hash === '#/more/restore') return;
  restore.keep = false;
  resetRestore();
}

export function renderRestore(el, ctx) {
  // A trip out to make a backup first (B05) must not throw away the file the
  // parent already chose; anything else starts clean.
  if (restore.keep) restore.keep = false;
  else resetRestore();
  const redraw = () => paint(el, restoreScreen(ctx, redraw));
  redraw();
  return ctx.store.subscribe(redraw);
}

function restoreScreen(ctx, redraw) {
  switch (restore.phase) {
    case 'preview': return previewScreen(ctx, redraw);
    case 'replace': return replaceScreen(ctx, redraw);
    case 'confirm': return confirmScreen(ctx, redraw);
    case 'done': return doneScreen(ctx);
    default: return chooseScreen(ctx, redraw);
  }
}

function chooseScreen(ctx, redraw) {
  const picker = h('input', {
    type: 'file', accept: '.json,application/json', k: 'file', 'aria-label': 'Backup file',
  });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch { text = ''; }
    read(text, redraw);
  });

  const box = h('textarea', { rows: 4, k: 'paste', 'aria-label': 'Backup text', placeholder: 'Paste JSON here' });
  box.value = restore.text;
  // Held as it is typed, not only when Preview is tapped: a re-render must
  // never throw away a pasted backup.
  box.addEventListener('input', () => { restore.text = box.value; });

  return [
    title({
      overline: 'Your records',
      name: 'Restore a backup',
      lead: 'First, choose the JSON backup you saved.',
    }),
    restore.error ? notice({ kind: 'error', title: restore.error, text: 'Your current log has not changed.' }) : null,
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'Backup file' }),
      h('div', { class: 'field-row' }, picker)),
    h('p', { class: 'small', text: 'Or paste the backup text' }),
    box,
    button({
      label: 'Preview backup', k: 'preview',
      onClick: () => { restore.text = box.value; read(box.value, redraw); },
    }),
    notice({ text: 'Nothing changes until you review the preview and confirm.' }),
    linkRow({ label: 'Back to More', href: '#/more', k: 'back' }),
  ];
}

function read(text, redraw) {
  const parsed = readBackup(text);
  if (!parsed.ok) {
    restore.doc = null;
    restore.error = parsed.message;
    redraw();
    return;
  }
  restore.doc = parsed.doc;
  restore.error = '';
  restore.mode = 'add';
  restore.phase = 'preview';
  redraw();
}

function previewScreen(ctx, redraw) {
  const local = ctx.store.get();
  const plan = restorePlan(local, restore.doc, 'add');
  restore.plan = plan;
  const blocked = plan.blocked;

  const rows = [
    ['File dates', plan.fromId ? `${dayLabelFor(plan.fromId)} – ${dayLabelFor(plan.toId)}` : 'No nights'],
    ['Nights in backup', String(plan.nights)],
    ['Routine records', String(plan.routines)],
    ['Already on this phone', `${plan.skipped} date${plan.skipped === 1 ? '' : 's'}`],
    plan.collided ? ['Skipped, entry already here', `${plan.collided} night${plan.collided === 1 ? '' : 's'}`] : null,
    ['New dates', `${plan.added} night${plan.added === 1 ? '' : 's'}`],
  ].filter(Boolean);

  return [
    title({ overline: 'Nothing has changed yet', name: 'Review this backup' }),
    h('table', { class: 'preview-table' },
      h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: v }))))),
    blocked
      ? notice({
        kind: 'error',
        title: 'This backup names a routine it does not contain.',
        text: plan.conflicts.find(c => c.reason === 'routine').text
          + ' Nothing can be imported until that is fixed.',
      })
      : null,
    // Named, not hidden: these dates are in the file and will not be added, so
    // the preview says which ones before anything is tapped.
    !blocked && plan.collided
      ? notice({
        kind: 'warm',
        title: `${plan.collided} night${plan.collided === 1 ? '' : 's'} will be skipped because an `
          + 'entry already exists on this phone.',
        text: plan.collidedIds.map(dayLabelFor).join(' · '),
      })
      : null,
    plan.routineIssues.map(text => notice({ kind: 'warm', title: 'Routines', text })),
    restore.error ? notice({ kind: 'error', title: restore.error, text: 'Your current log has not changed.' }) : null,
    h('h3', { text: 'How to restore' }),
    notice({
      title: 'Add missing nights',
      text: `Keep the ${plan.skipped} overlapping date${plan.skipped === 1 ? '' : 's'} on this phone. `
        + `Add the ${plan.added} new date${plan.added === 1 ? '' : 's'}.`,
    }),
    blocked ? null : button({
      label: plan.added ? `Add ${plan.added} missing night${plan.added === 1 ? '' : 's'}` : 'Nothing to add',
      kind: 'primary', k: 'add',
      onClick: () => { if (plan.added) apply(ctx, 'add', redraw); },
    }),
    blocked ? null : linkRow({
      label: 'Replace this phone’s log instead…',
      onClick: () => { restore.phase = 'replace'; redraw(); },
      k: 'replace',
    }),
    button({ label: 'Cancel', kind: 'quiet', k: 'cancel', onClick: () => { resetRestore(); redraw(); } }),
  ];
}

function replaceScreen(ctx, redraw) {
  const local = ctx.store.get();
  const plan = restorePlan(local, restore.doc, 'replace');
  restore.plan = plan;

  return [
    title({ overline: 'Restore backup', name: 'Replace this log?' }),
    notice({
      kind: 'warm',
      title: `${plan.replaced} night${plan.replaced === 1 ? '' : 's'} on this phone will be replaced.`,
      text: `The backup contains ${plan.nights} night${plan.nights === 1 ? '' : 's'}`
        + `${plan.fromId ? ` from ${dayLabelFor(plan.fromId)} to ${dayLabelFor(plan.toId)}` : ''}. `
        + 'Local nights absent from that file will be removed.',
    }),
    button({
      label: 'Back up current log first', kind: 'primary', k: 'backup-first',
      onClick: () => { restore.keep = true; ctx.navigate('#/more/backup'); },
    }),
    button({
      label: 'Skip backup and replace…', kind: 'danger', k: 'skip-backup',
      onClick: () => { restore.phase = 'confirm'; redraw(); },
    }),
    button({
      label: 'Keep current log', kind: 'quiet', k: 'keep',
      onClick: () => { restore.phase = 'preview'; redraw(); },
    }),
  ];
}

function confirmScreen(ctx, redraw) {
  const plan = restore.plan;
  return [
    title({ overline: 'Restore backup', name: 'Confirm replacement' }),
    h('p', { class: 'lead', text: `Replace all ${plan.replaced} night${plan.replaced === 1 ? '' : 's'} `
      + `on this phone with the ${plan.nights} night${plan.nights === 1 ? '' : 's'} in this backup?` }),
    restore.error ? notice({ kind: 'error', title: restore.error, text: 'Your current log has not changed.' }) : null,
    button({
      label: `Replace all ${plan.replaced} night${plan.replaced === 1 ? '' : 's'}`,
      kind: 'danger', k: 'confirm-replace',
      onClick: () => apply(ctx, 'replace', redraw),
    }),
    button({
      label: 'Cancel replacement', kind: 'quiet', k: 'cancel-replace',
      onClick: () => { restore.phase = 'preview'; redraw(); },
    }),
  ];
}

function apply(ctx, mode, redraw) {
  const before = ctx.store.get();
  const plan = restorePlan(before, restore.doc, mode);
  const next = applyRestore(before, restore.doc, mode);
  if (next?.error) { restore.error = next.error; redraw(); return; }
  const written = ctx.store.replace(next);
  if (!written.ok) {
    restore.error = 'Not saved. There isn’t enough space for these records.';
    redraw();
    return;
  }
  restore.result = { mode, plan, total: next.nights.length };
  restore.phase = 'done';
  redraw();
}

function doneScreen(ctx) {
  const { mode, plan, total } = restore.result;
  const replaced = mode === 'replace';
  return [
    title({ overline: 'Restore complete', name: 'Your nights are here' }),
    savedStrip({
      text: replaced
        ? `${plan.nights} night${plan.nights === 1 ? '' : 's'} restored`
        : `${plan.added} night${plan.added === 1 ? '' : 's'} added`,
      detail: replaced
        ? 'The previous log was replaced'
        : `${plan.skipped} overlapping date${plan.skipped === 1 ? '' : 's'} kept unchanged`,
    }),
    h('p', { class: 'lead', text: `There ${total === 1 ? 'is' : 'are'} now ${total} `
      + `night${total === 1 ? '' : 's'} on this phone.` }),
    plan.collided
      ? h('p', { class: 'small', text: `${plan.collided} night${plan.collided === 1 ? '' : 's'} skipped `
        + `because an entry already exists on this phone: ${plan.collidedIds.map(dayLabelFor).join(' · ')}.` })
      : null,
    plan.routinesAdded
      ? h('p', { class: 'small', text: `${plan.routinesAdded} routine record${plan.routinesAdded === 1 ? '' : 's'} came with them.` })
      : null,
    button({ label: 'Open History', kind: 'primary', href: '#/history', k: 'history' }),
    linkRow({ label: 'Back to More', href: '#/more', k: 'back' }),
  ];
}

/* ── O01/O03 · Export ───────────────────────────────────────────────────
   A share of a chosen range, which is not the same thing as a backup of the
   whole log — so the two live on separate screens and say so. */

const exportState = { fromId: null, toId: null, phase: 'idle', name: '', rows: 0, error: '' };

// Shared with the summary sheet, so both open on the same range.
export function exportRange(doc, now) {
  if (!exportState.fromId || !exportState.toId) {
    // The night the clock is inside is still being lived, so the default range
    // ends where Patterns ends — otherwise the same 28 days read as 29 here.
    const toId = lastCompletedNightId(now);
    const first = doc.nights.length ? doc.nights[0].id : null;
    const fallback = shiftDate(toId, -27);
    exportState.toId = toId;
    exportState.fromId = first && first > fallback ? first : fallback;
  }
  return { fromId: exportState.fromId, toId: exportState.toId };
}

export function renderExport(el, ctx) {
  exportState.phase = 'idle';
  exportState.error = '';
  exportRange(ctx.store.get(), ctx.now());
  const redraw = () => paint(el, exportScreen(ctx, redraw));
  redraw();
  return ctx.store.subscribe(redraw);
}

function exportScreen(ctx, redraw) {
  if (exportState.phase !== 'idle') return exportReady(ctx, redraw);
  const doc = ctx.store.get();

  const countLine = () => {
    if (exportState.fromId > exportState.toId) return 'Choose a range that runs forwards';
    const count = csvRows(doc, exportState.fromId, exportState.toId).length - 1;
    return `${count} night${count === 1 ? '' : 's'} in this range, one row each`;
  };
  const csvRow = linkRow({
    label: 'Spreadsheet · CSV',
    sub: countLine(),
    onClick: () => prepareCsv(ctx, redraw),
    k: 'csv',
  });
  const countNote = csvRow.querySelector('small');
  const rangeError = h('div');

  // Changing a date must not redraw this screen: the change event fires on the
  // blur of the very tap that is landing on the CSV row, and a redraw would
  // replace that row before the tap reached it. Only the two bits of text that
  // depend on the range are rewritten.
  const refresh = () => {
    countNote.textContent = countLine();
    rangeError.replaceChildren(...(exportState.fromId > exportState.toId
      ? [notice({
        kind: 'error',
        title: 'The first date is after the last one.',
        text: 'Choose a range that runs forwards.',
      })]
      : []));
  };

  return [
    title({ overline: 'Export & summary', name: 'Take a copy' }),
    rangeField('From', 'fromId', refresh),
    rangeField('Through', 'toId', refresh),
    rangeError,
    csvRow,
    linkRow({ label: 'Full backup · JSON', sub: 'All dates and details', href: '#/more/backup', k: 'json' }),
    linkRow({ label: 'Printable summary', sub: 'Preview before saving or sharing', href: '#/summary', k: 'summary' }),
    notice({
      title: 'Blank values stay blank.',
      text: 'Unknown answers are never exported as No, zero, or Dry.',
    }),
    linkRow({ label: 'Back to More', href: '#/more', k: 'back' }),
  ];
}

function rangeField(label, key, onChange) {
  const input = h('input', { type: 'date', k: key, 'aria-label': label, value: exportState[key] ?? '' });
  input.addEventListener('change', () => {
    if (!input.value) { input.value = exportState[key] ?? ''; return; }
    exportState[key] = input.value;
    onChange();
  });
  return h('div', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'field-row' }, input));
}

function prepareCsv(ctx, redraw) {
  if (exportState.fromId > exportState.toId) return;
  exportState.name = csvFileName(exportState.fromId, exportState.toId);
  exportState.rows = csvRows(ctx.store.get(), exportState.fromId, exportState.toId).length - 1;
  exportState.phase = 'ready';
  exportState.error = '';
  redraw();
}

function exportReady(ctx, redraw) {
  const cancelled = exportState.phase === 'cancelled';
  const failed = exportState.phase === 'failed';
  return [
    title({
      overline: `${dayLabelFor(exportState.fromId)} – ${dayLabelFor(exportState.toId)}`,
      name: 'Your export is ready',
    }),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'File' }),
      h('div', { class: 'field-value', text: exportState.name })),
    h('p', { class: 'lead', text: `${exportState.rows} nightly row${exportState.rows === 1 ? '' : 's'}. `
      + 'Missing answers are blank.' }),
    exportState.error ? notice({ kind: 'error', title: exportState.error, text: 'Your records are unchanged.' }) : null,
    cancelled ? notice({ title: 'Nothing was saved.', text: 'The share was cancelled; your records are unchanged.' }) : null,
    exportState.phase === 'sent'
      ? notice({ title: 'Handed to the share sheet.', text: NOT_VERIFIED })
      : button({
        label: cancelled || failed ? 'Try again' : 'Save or share CSV',
        kind: 'primary', icon: 'share', k: 'send-csv',
        onClick: () => sendCsv(ctx, redraw),
      }),
    button({
      label: 'Back to export options', kind: 'quiet', k: 'back-export',
      onClick: () => { exportState.phase = 'idle'; redraw(); },
    }),
  ];
}

async function sendCsv(ctx, redraw) {
  const text = csvText(ctx.store.get(), exportState.fromId, exportState.toId);
  const result = await deliver({ text, name: exportState.name, type: 'text/csv' });
  if (result.cancelled) { exportState.phase = 'cancelled'; exportState.error = ''; }
  else if (!result.ok) { exportState.phase = 'failed'; exportState.error = 'No file was created. Try again.'; }
  else { exportState.phase = 'sent'; exportState.error = ''; }
  redraw();
}

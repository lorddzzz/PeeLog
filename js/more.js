// W01–W02 and M01–M03: everything that is not a night. Maintenance, sharing
// and installation live here so the nighttime screens stay a grid of five
// buttons — the backup status is shown on this tab and after the morning
// review, never above the action grid (UX-HANDOFF M01).

import { deliver, backupAgeLabel, OVERDUE_DAYS } from './backup.js';
import { exportFileName } from './model.js';
import { renderChecks, runChecks, runSelfTests } from './selftest.js';
import { button, h, icon, linkRow, notice, paint, title } from './ui.js';

/* ── W01 · Welcome ──────────────────────────────────────────────────────
   Shown once, on a phone with nothing recorded. Nothing on it blocks the
   first tap: no permission prompt, no tour, no backup nudge (rule 8). */

export function renderWelcome(el, ctx) {
  paint(el, [
    h('img', { class: 'art', src: 'assets/art/bedside-notebook.jpg', alt: '' }),
    title({
      overline: 'Welcome to PeeLog',
      name: 'A little context, one night at a time.',
      lead: 'Quick notes through the night. A clearer picture when you need it.',
    }),
    button({
      label: 'Start logging', kind: 'primary', k: 'start',
      onClick: () => {
        // A failed write here must not stand between a tired parent and the
        // action grid; Welcome simply shows once more next launch.
        ctx.store.update(d => { d.settings.welcomed = true; });
        ctx.navigate('#/tonight');
      },
    }),
    button({ label: 'Install on this phone', href: '#/more/install', k: 'install' }),
    linkRow({ label: 'Restore a backup', href: '#/more/restore', k: 'restore' }),
    h('p', { class: 'small', text: 'Your records stay on this phone. No account. No analytics. '
      + 'Save a backup to keep a separate copy.' }),
  ]);
}

/* ── M01 · More ─────────────────────────────────────────────────────── */

export function render(el, ctx) {
  const draw = () => paint(el, moreScreen(ctx));
  draw();
  return ctx.store.subscribe(draw);
}

function moreScreen(ctx) {
  const doc = ctx.store.get();
  const age = backupAgeLabel(doc.settings, ctx.now());

  return [
    title({ overline: 'A little more', name: 'Your bedside space' }),
    backupRow(age),
    linkRow({ label: 'Export & summary', sub: 'A spreadsheet, backup, or printable sheet', href: '#/more/export' }),
    linkRow({
      label: 'Appearance',
      sub: doc.settings.art === false ? 'Dark, illustrations off' : 'Dark, with bedtime illustration',
      href: '#/more/appearance',
    }),
    linkRow({ label: 'Install & offline', sub: 'Check this phone', href: '#/more/install' }),
    linkRow({ label: 'Privacy & reminders', sub: 'How your records stay with you', href: '#/more/privacy' }),
  ];
}

// Built by hand rather than through linkRow: past ten days the age turns the
// colour wet observations use, and only this row does that.
function backupRow(age) {
  return h('a', { class: 'linkrow', href: '#/more/backup', 'data-k': 'backup' },
    h('span', { text: 'Backup & restore' },
      h('small', { class: age.overdue ? 'overdue' : null, text: `Last backup: ${age.text}` })),
    icon('chevron-right'));
}

/* ── M02 · Appearance ───────────────────────────────────────────────────
   The art toggle removes decoration without moving a single control, so the
   preview keeps its height when the illustration goes. */

export function renderAppearance(el, ctx) {
  const draw = () => paint(el, appearance(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function toggleRow({ label, sub, on, disabled, onChange, k }) {
  const control = h('button', {
    class: `toggle${on ? '' : ' off'}${disabled ? ' disabled' : ''}`,
    type: 'button', role: 'switch', k,
    'aria-checked': on ? 'true' : 'false',
    'aria-label': label,
    disabled: disabled || null,
    'on:click': () => { if (!disabled) onChange(!on); },
  });
  return h('div', { class: 'toggle-row' },
    h('span', { text: label }, sub ? h('small', { class: 'small', text: sub }) : null),
    control);
}

function appearance(ctx, draw) {
  const doc = ctx.store.get();
  const art = doc.settings.art !== false;
  const hasWakeLock = 'wakeLock' in navigator;

  return [
    title({ overline: 'Appearance', name: 'A little quieter' }),
    art
      ? h('img', { class: 'art preview', src: 'assets/art/bedtime-moon.jpg', alt: '' })
      : h('div', { class: 'art-off preview' }, h('span', { text: 'Illustrations are off' })),
    toggleRow({
      label: 'Bedtime illustration',
      sub: 'Static, never animated',
      on: art,
      k: 'art',
      onChange: value => { ctx.store.update(d => { d.settings.art = value; }); draw(); },
    }),
    toggleRow({
      label: 'Keep screen awake',
      sub: hasWakeLock ? 'While PeeLog is open, this visit' : 'Not available on this browser',
      on: hasWakeLock && keepAwake.wanted,
      disabled: !hasWakeLock,
      k: 'awake',
      onChange: value => { setKeepAwake(value); draw(); },
    }),
    hasWakeLock
      ? null
      : notice({
        title: 'Keep screen awake is unavailable here.',
        text: 'Safari on iOS does not offer the Screen Wake Lock API, so the screen will '
          + 'dim as usual. The action buttons are sized to survive that.',
      }),
    notice({
      title: 'Dark appearance throughout.',
      text: 'Motion follows your phone’s reduced-motion setting. There is no daytime theme; '
        + 'the printable summary is the only light page.',
    }),
    linkRow({ label: 'Back to More', href: '#/more', k: 'back' }),
  ];
}

/* ── Wake lock ──────────────────────────────────────────────────────────
   Session-only on purpose: a lock cannot be held across a relaunch, and a
   remembered setting that silently does nothing would be a promise the
   platform does not keep. Expected to be absent on iOS entirely. */

const keepAwake = { wanted: false, lock: null };

async function acquire() {
  if (!('wakeLock' in navigator) || keepAwake.lock || document.hidden) return;
  try {
    keepAwake.lock = await navigator.wakeLock.request('screen');
    keepAwake.lock.addEventListener('release', () => { keepAwake.lock = null; });
  } catch {
    // Denied (low battery, no gesture) — the toggle stays on, the screen dims.
    keepAwake.lock = null;
  }
}

function setKeepAwake(on) {
  keepAwake.wanted = on;
  if (on) acquire();
  else { keepAwake.lock?.release?.(); keepAwake.lock = null; }
}

// The lock is dropped whenever the page is hidden, so it has to be re-taken
// on return or the setting would look on and do nothing.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keepAwake.lock = null; return; }
  if (keepAwake.wanted) acquire();
});

/* ── W02 · Install & offline, with the install check ────────────────────
   The Check tab's rows move here at M5. They are still the closest thing
   this app has to a test suite, so they keep their own screen section
   rather than being folded into a line of prose. */

export function renderInstall(el, ctx) {
  const list = h('dl', { class: 'checks', id: 'checks' });
  const status = h('p', { class: 'small' });
  const app = ctx.app ?? {};

  const refresh = async () => {
    renderChecks(list, [...await runChecks(app.version ?? ''), ...runSelfTests()]);
  };

  paint(el, [
    title({
      overline: 'Install & offline',
      name: 'At your bedside',
      lead: 'Keep PeeLog on your home screen.',
    }),
    h('ol', { class: 'ordered' },
      h('li', { text: 'In Safari, open the Share menu.' }),
      h('li', { text: 'Choose Add to Home Screen.' }),
      h('li', { text: 'Open PeeLog from its new icon.' })),
    h('p', { class: 'small', text: 'Safari is the only iOS browser that can install a home-screen '
      + 'app. There is no in-app install button to offer — the Share menu is the route.' }),
    app.sw?.updateReady?.()
      ? notice({
        kind: 'warm',
        title: 'An update is ready.',
        text: 'Finish your changes before reloading.',
        children: [button({ label: 'Reload', k: 'reload', onClick: () => location.reload() })],
      })
      : null,
    h('h3', { text: 'On this phone' }),
    list,
    h('div', { class: 'actions' },
      h('button', { type: 'button', k: 'persist', 'on:click': async () => {
        if (navigator.storage?.persist) await navigator.storage.persist();
        refresh();
      } }, 'Request persistent storage'),
      h('button', { type: 'button', k: 'recheck', 'on:click': refresh }, 'Re-run checks'),
      h('button', { type: 'button', k: 'update', 'on:click': async () => {
        await app.sw?.update?.();
        location.reload();
      } }, 'Check for update'),
      h('button', { type: 'button', k: 'export', 'on:click': async () => {
        // The M1 escape hatch, kept: the whole document, no range, no
        // timestamps touched. B01 is the flow that records a backup.
        const name = exportFileName(ctx.now());
        const result = await deliver({
          text: JSON.stringify(ctx.store.get(), null, 2),
          name,
          type: 'application/json',
        });
        status.textContent = result.ok
          ? `${name} — prepared, not confirmed saved.`
          : 'No file was created.';
      } }, 'Export JSON')),
    status,
    notice({
      text: 'Storage retention is decided by the browser. A separate backup is the only '
        + 'thing that survives a lost phone or cleared site data.',
    }),
    linkRow({ label: 'Backup & restore', href: '#/more/backup', k: 'backup' }),
    linkRow({ label: 'Back to More', href: '#/more', k: 'back' }),
  ]);

  refresh();
}

/* ── M03 · Privacy & reminders ──────────────────────────────────────── */

export function renderPrivacy(el, ctx) {
  const doc = ctx.store.get();
  const age = backupAgeLabel(doc.settings, ctx.now());
  paint(el, [
    title({ overline: 'Privacy & reminders', name: 'Just on this phone' }),
    h('h3', { text: 'Your records' }),
    h('p', { class: 'lead', text: 'PeeLog keeps its records in this browser, or in the installed '
      + 'app. There is no account, no server and no analytics, and nothing is sent anywhere. '
      + 'Clearing browser data, losing the phone, or an iOS storage cleanup can lose the log.' }),
    h('p', { class: 'lead', text: 'Only an export you choose leaves the phone, and where it goes '
      + 'afterwards is up to you.' }),
    linkRow({
      label: 'Make a separate backup',
      sub: `Last backup: ${age.text}`,
      href: '#/more/backup',
      k: 'backup',
    }),
    h('h3', { text: 'A gentle reminder' }),
    h('p', { class: 'lead', text: 'Use your phone’s Reminders or alarms for a bedtime note and a '
      + 'morning review. PeeLog cannot schedule an alarm: iOS gives web apps no reliable '
      + 'scheduled notification, and this app has no server to send one from.' }),
    h('p', { class: 'lead', text: 'A repeating alarm at bedtime and another at wake-up is the '
      + 'whole setup. A Shortcut that opens PeeLog makes each one a single tap, where your '
      + 'phone supports it.' }),
    h('p', { class: 'small', text: `The backup nudge here turns amber after ${OVERDUE_DAYS} days. `
      + 'It never appears on the nighttime screen.' }),
    linkRow({ label: 'Install & offline check', href: '#/more/install', k: 'install' }),
    linkRow({ label: 'Back to More', href: '#/more', k: 'back' }),
  ]);
}

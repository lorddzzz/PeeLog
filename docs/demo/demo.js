'use strict';
// Visual study only. Nothing is written to the real PeeLog store.
const labels = { selfToilet: 'Asked to pee', lift: 'Lifted to toilet', drink: 'Water', wake: 'Woke up', wet: 'Wet bed' };
const options = { selfToilet: ['Made it', 'Didn’t make it'], lift: ['No pee', 'Some', 'Lots'], drink: ['A sip', 'A cup'], wake: [], wet: ['Damp', 'Wet', 'Soaked'] };
let events = [{ type: 'drink', time: '23:40', detail: 'A sip' }];
let outcome = null;
const $ = id => document.getElementById(id);
function update() {
  const last = events.at(-1);
  $('event-count').textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
  $('saved-title').textContent = last ? `${labels[last.type]} · ${last.time}` : 'Nothing logged yet';
  $('saved-subtitle').textContent = last ? (last.detail ? `Last event · ${last.detail.toLowerCase()}` : 'Recorded in this demo') : 'Ready whenever you need it';
  $('undo').disabled = !last;
  $('history-events').textContent = `${events.length} event${events.length === 1 ? '' : 's'} · ${outcome ? 'morning reviewed' : 'night in progress'}`;
  $('history-outcome').textContent = outcome || 'Open';
  $('history-outcome').className = `outcome ${outcome === 'Wet' ? 'wet-outcome' : outcome ? '' : 'pending'}`;
}
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(screen => { screen.hidden = screen.id !== name; });
  document.querySelectorAll('[data-screen]').forEach(button => {
    if (button.dataset.screen === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
function showDetails() {
  const last = events.at(-1);
  const choices = last ? options[last.type] : [];
  $('details').hidden = !choices.length;
  $('chips').replaceChildren();
  choices.forEach(choice => {
    const button = document.createElement('button');
    button.textContent = choice;
    button.setAttribute('aria-pressed', String(last.detail === choice));
    button.addEventListener('click', () => {
      last.detail = last.detail === choice ? null : choice;
      for (const chip of $('chips').children) chip.setAttribute('aria-pressed', String(chip.textContent === last.detail));
      update();
    });
    $('chips').append(button);
  });
}
document.querySelectorAll('[data-event]').forEach(button => button.addEventListener('click', () => {
  events.push({ type: button.dataset.event, time: '02:12', detail: null });
  outcome = null;
  $('morning-feedback').textContent = 'Choose an outcome to complete the demo night.';
  document.querySelectorAll('[data-outcome]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  update();
  showDetails();
}));
$('undo').addEventListener('click', () => { events.pop(); $('details').hidden = true; update(); });
$('done').addEventListener('click', () => { $('details').hidden = true; $('undo').focus(); });
document.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.screen)));
$('morning-open').addEventListener('click', () => showScreen('morning'));
$('back').addEventListener('click', () => showScreen('tonight'));
$('show-art').addEventListener('change', event => document.querySelector('.bedtime-art').classList.toggle('art-hidden', !event.target.checked));
document.querySelectorAll('[data-outcome]').forEach(button => button.addEventListener('click', () => {
  outcome = button.dataset.outcome;
  document.querySelectorAll('[data-outcome]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  $('morning-feedback').textContent = `${outcome} night recorded in this demo. You can change it here.`;
  update();
}));
$('reset').addEventListener('click', () => location.reload());
update();

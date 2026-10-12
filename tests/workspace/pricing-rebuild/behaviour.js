// Local behaviour for the reconstruction. Every control does what the
// reference was observed to do in Copycat's interaction matrix.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Mobile menu: toggles the nav (observed: aria-expanded false→true, second click closes).
const menuBtn = $('.topbar__menu');
const nav = $('#primary-nav');
menuBtn.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  menuBtn.setAttribute('aria-expanded', String(open));
});

// Products flyout (observed: opens on click, closes on Escape and outside click).
const trigger = $('.primary__trigger');
const flyout = $('#product-list');
const setFlyout = (open) => { flyout.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); };
trigger.addEventListener('click', (e) => { e.stopPropagation(); setFlyout(flyout.hidden); });
document.addEventListener('click', (e) => { if (!flyout.contains(e.target)) setFlyout(false); });

// Billing tabs (observed: aria-selected moves, prices switch).
const tabs = $$('.period__tab');
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
    const p = tab.dataset.period;
    for (const el of $$('.tier__amount')) el.textContent = el.dataset[p];
    for (const el of $$('.tier__per')) el.textContent = `/ ${p}`;
  });
}

// Contact dialog (observed: opens dialog, Escape closes, focus moves).
const dialog = $('#sales-dialog');
const opener = $('[data-dialog-open]');
const closeDialog = () => { dialog.hidden = true; opener.focus(); };
opener.addEventListener('click', () => { dialog.hidden = false; $('[data-dialog-close]', dialog).focus(); });
$('[data-dialog-close]', dialog).addEventListener('click', closeDialog);
dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  setFlyout(false);
  if (!dialog.hidden) closeDialog();
});

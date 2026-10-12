// Fixture behaviour for Copycat integration tests.
(() => {
  // A fake, key-shaped string built at runtime so no secret-like literal lives in the repo.
  const fakeKey = document.getElementById('fake-key');
  if (fakeKey) fakeKey.textContent = ['sk', 'live', 'FAKE0123456789abcdef'].join('_');

  const toggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  const trigger = document.querySelector('.nav-trigger');
  const menu = document.getElementById('products-menu');
  if (trigger && menu) {
    const set = (open) => { menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); };
    trigger.addEventListener('click', (e) => { e.stopPropagation(); set(menu.hidden); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }

  // Tabs (pricing)
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    const period = tab.dataset.period;
    document.querySelectorAll('[data-monthly]').forEach((el) => {
      el.textContent = period === 'yearly' ? el.dataset.yearly : el.dataset.monthly;
    });
    document.querySelectorAll('.per').forEach((el) => { el.textContent = period === 'yearly' ? '/ year' : '/ month'; });
  }));

  // Modal
  const openBtn = document.querySelector('[data-open-modal]');
  const backdrop = document.getElementById('contact-modal');
  if (openBtn && backdrop) {
    const close = () => { backdrop.hidden = true; openBtn.focus(); };
    openBtn.addEventListener('click', () => { backdrop.hidden = false; backdrop.querySelector('button.close').focus(); });
    backdrop.querySelector('button.close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) close(); });
  }

  // Sidebar collapse + filters (dashboard)
  const collapse = document.querySelector('[data-collapse]');
  if (collapse) collapse.addEventListener('click', () => {
    const layout = document.querySelector('.layout');
    const collapsed = layout.classList.toggle('collapsed');
    collapse.setAttribute('aria-expanded', String(!collapsed));
  });
  const filters = [...document.querySelectorAll('[data-filter]')];
  filters.forEach((b) => b.addEventListener('click', () => {
    filters.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('tbody tr').forEach((tr) => {
      tr.hidden = b.dataset.filter !== 'all' && tr.dataset.status !== b.dataset.filter;
    });
  }));

  // Form validation (signup)
  const form = document.getElementById('signup-form');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    const check = (input, msg) => {
      const err = document.getElementById(`${input.id}-error`);
      const bad = Boolean(msg);
      input.setAttribute('aria-invalid', String(bad));
      err.textContent = msg || '';
      if (bad) ok = false;
    };
    const name = form.elements.namedItem('name');
    const email = form.elements.namedItem('email');
    const team = form.elements.namedItem('team');
    check(name, name.value.trim().length < 2 ? 'Enter your full name.' : '');
    check(email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value) ? '' : 'Enter a valid email address.');
    check(team, team.value ? '' : 'Choose a team size.');
    if (ok) {
      form.hidden = true;
      document.getElementById('signup-success').hidden = false;
    }
  });
})();

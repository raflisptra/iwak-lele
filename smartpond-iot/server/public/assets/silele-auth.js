// Minimal integration with the original SiLele UI, without replacing its dashboard logic.
(async function () {
  const btn = document.getElementById('btnLogout');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
    finally { location.replace('/login'); }
  });
  try {
    const resp = await fetch('/auth/me', {credentials:'same-origin',cache:'no-store'});
    if (resp.status === 401) { location.replace('/login'); return; }
    if (resp.ok) {
      const data = await resp.json();
      const user = document.getElementById('sileleUser');
      if (user) user.textContent = `${data.username} (${data.role})`;
    }
  } catch (_) { /* dashboard can still show existing sensor data when offline */ }
})();

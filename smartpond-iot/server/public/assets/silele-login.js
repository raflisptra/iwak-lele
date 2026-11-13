const form = document.getElementById('loginForm');
const error = document.getElementById('error');
const submit = document.getElementById('submit');
const password = document.getElementById('password');
document.getElementById('togglePass').addEventListener('click', (event) => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  event.target.textContent = show ? 'Tutup' : 'Lihat';
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Memverifikasi...';
  try {
    const response = await fetch('/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({username: document.getElementById('username').value.trim(), password:password.value})
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Login gagal');
    location.replace('/');
  } catch (e) { error.textContent = e.message || 'Tidak dapat menghubungi server'; }
  finally { submit.disabled = false; submit.textContent = 'Masuk'; }
});

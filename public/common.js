/* Shared helpers for Nirakar Attendance */
const TZ = 'Asia/Kathmandu';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function getToken(role) { return localStorage.getItem('nirakar_' + role + '_token'); }
function setToken(role, t) { localStorage.setItem('nirakar_' + role + '_token', t); }
function logout(role) { localStorage.removeItem('nirakar_' + role + '_token'); location.href = '/'; }

async function api(role, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken(role);
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && role) { logout(role); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

async function download(role, path, filename) {
  const res = await fetch(path, { headers: { Authorization: 'Bearer ' + getToken(role) } });
  if (!res.ok) throw new Error('Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '';
function badge(status) {
  const c = { 'Present': 'b-present', 'Half Day': 'b-half', 'Checked In': 'b-in', 'Missing Check-out': 'b-miss' }[status] || 'b-off';
  return `<span class="badge ${c}">${esc(status)}</span>`;
}
const monthNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date());

/* Photos need the auth header, so load them as blobs */
function photoTag(file) { return file ? `<img class="thumb" alt="photo" data-photo="${esc(file)}">` : '—'; }
async function hydratePhotos(role, root = document) {
  for (const img of $$('img[data-photo]', root)) {
    try {
      const res = await fetch('/api/photo/' + encodeURIComponent(img.dataset.photo), { headers: { Authorization: 'Bearer ' + getToken(role) } });
      if (!res.ok) continue;
      img.src = URL.createObjectURL(await res.blob());
      img.removeAttribute('data-photo');
      img.onclick = () => showImage(img.src);
    } catch (e) {}
  }
}
function showImage(src) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box"><img src="${src}" style="width:100%;border-radius:10px"><button class="btn secondary" style="width:100%;margin-top:.6rem">Close</button></div>`;
  m.onclick = e => { if (e.target === m || e.target.tagName === 'BUTTON') m.remove(); };
  document.body.appendChild(m);
}

/* Mandatory live photo capture. Resolves with a JPEG data URL, or null if cancelled. */
function capturePhoto(title) {
  return new Promise(resolve => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="box cam"><h3>${esc(title)}</h3>
      <p class="msg err hidden" id="camErr"></p>
      <video autoplay playsinline muted></video>
      <img class="preview hidden" alt="preview">
      <canvas class="hidden"></canvas>
      <div class="row" style="margin-top:.7rem">
        <button class="btn" id="snap">📷 Take Photo</button>
        <button class="btn secondary hidden" id="retake">Retake</button>
        <button class="btn brown hidden" id="use">Submit</button>
      </div>
      <button class="btn secondary" id="cancel" style="width:100%;margin-top:.6rem">Cancel</button></div>`;
    document.body.appendChild(m);
    const video = $('video', m), prev = $('.preview', m), canvas = $('canvas', m);
    let stream = null, data = null;
    const stop = () => stream && stream.getTracks().forEach(t => t.stop());
    const done = v => { stop(); m.remove(); resolve(v); };

    // Resize big camera photos so uploads stay small
    function toData(source, w, h) {
      const max = 720, k = Math.min(1, max / Math.max(w, h));
      canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.75);
    }
    function review(d) {
      data = d; prev.src = d;
      video.classList.add('hidden'); prev.classList.remove('hidden');
      $('#snap', m).classList.add('hidden'); $('#retake', m).classList.remove('hidden'); $('#use', m).classList.remove('hidden');
    }
    $('#cancel', m).onclick = () => done(null);
    $('#use', m).onclick = () => done(data);
    $('#retake', m).onclick = () => {
      data = null; prev.classList.add('hidden'); video.classList.remove('hidden');
      $('#snap', m).classList.remove('hidden'); $('#retake', m).classList.add('hidden'); $('#use', m).classList.add('hidden');
      if (!stream) openFallback();
    };
    $('#snap', m).onclick = () => {
      if (stream && video.videoWidth) review(toData(video, video.videoWidth, video.videoHeight));
      else openFallback();
    };
    function openFallback() { // phone camera app via file input (used when live camera is unavailable)
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'user');
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const img = new Image();
        img.onload = () => review(toData(img, img.naturalWidth, img.naturalHeight));
        img.src = URL.createObjectURL(f);
      };
      inp.click();
    }
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        .then(s => { stream = s; video.srcObject = s; })
        .catch(() => { $('#camErr', m).textContent = 'Camera access was blocked. Allow camera permission, or tap "Take Photo" to use your phone camera.'; $('#camErr', m).classList.remove('hidden'); video.classList.add('hidden'); });
    } else {
      video.classList.add('hidden');
    }
  });
}

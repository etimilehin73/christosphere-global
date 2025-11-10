// Frontend that talks to API
// Post shape: {id, title, body, videoUrl?, createdAt}

const API_BASE = '/api';

async function loadPosts(){
  const res = await fetch(API_BASE + '/posts');
  if (!res.ok) return [];
  return res.json();
}

async function renderFeed(){
  const feed = document.getElementById('feed');
  if(!feed) return;
  const posts = await loadPosts();
  feed.innerHTML = '';
  if(!posts || posts.length===0){
    feed.innerHTML = '<div class="card"><p>No posts yet.</p></div>';
    return;
  }

  posts.forEach(p=>{
    const el = document.createElement('article');
    el.className = 'card post';
    const excerpt = (p.body||'').length>200 ? escapeHtml((p.body||'').slice(0,200)) + '…' : escapeHtml(p.body||'');
    el.innerHTML = `
      <h3><a href="post.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a></h3>
      <div class="meta">${new Date(p.createdAt).toLocaleString()}</div>
      <p>${excerpt}</p>
    `;

  if(p.videoUrl){
      if(isYouTubeUrl(p.videoUrl)){
        const iframe = document.createElement('iframe');
        iframe.src = convertYouTubeEmbed(p.videoUrl);
        iframe.width = '560';
        iframe.height = '315';
        iframe.setAttribute('frameborder','0');
        iframe.setAttribute('allow','accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.allowFullscreen = true;
        el.appendChild(iframe);
      }else{
        const video = document.createElement('video');
        video.controls = true;
        video.src = p.videoUrl;
        el.appendChild(video);
      }
    }

    feed.appendChild(el);
  });
}

// Admin logic
async function initAdmin(){
  const loginForm = document.getElementById('login-form');
  const adminPanel = document.getElementById('admin-panel');
  const loginInput = document.getElementById('admin-password');
  const logoutBtn = document.getElementById('logout');
  const postForm = document.getElementById('post-form');
  const adminPosts = document.getElementById('admin-posts');

  async function checkAuth(){
    const res = await fetch(API_BASE + '/auth', { credentials: 'include' });
    const info = await res.json();
    return info.authed;
  }

  if(await checkAuth()){
    adminPanel.classList.remove('hidden');
    loginForm.closest('.card').classList.add('hidden');
  }

  loginForm.addEventListener('submit', async e=>{
    e.preventDefault();
  const res = await fetch(API_BASE + '/login', { method: 'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ password: loginInput.value }), credentials: 'include' });
    if (res.ok){
      adminPanel.classList.remove('hidden');
      loginForm.closest('.card').classList.add('hidden');
      await renderAdminPosts();
        startPendingPoll();
    updateAdminPending();
    await renderAdminActivity();
      showToast('Logged in');
    } else {
      showToast('Bad password', true);
    }
  });

  logoutBtn.addEventListener('click', async ()=>{
  await fetch(API_BASE + '/logout', { method: 'POST', credentials: 'include' });
    adminPanel.classList.add('hidden');
    loginForm.closest('.card').classList.remove('hidden');
    showToast('Logged out');
  });

  postForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const form = new FormData();
    form.append('title', document.getElementById('post-title').value.trim());
    form.append('body', document.getElementById('post-body').value.trim());
    const videoUrl = document.getElementById('post-video-url').value.trim();
    if(videoUrl) form.append('videoUrl', videoUrl);
    const videoFile = document.getElementById('post-video-file').files[0];
    if(videoFile) form.append('video', videoFile);

  const res = await fetch(API_BASE + '/posts', { method: 'POST', body: form, credentials: 'include' });
    if (res.ok){
      postForm.reset();
      await renderAdminPosts();
      await renderFeed();
      showToast('Post published');
    } else if (res.status===401){
      showToast('Not authenticated', true);
    } else {
      showToast('Failed to publish', true);
    }
  });

  async function renderAdminPosts(){
    const posts = await loadPosts();
    adminPosts.innerHTML = '';
    posts.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'card';
      row.innerHTML = `
        <strong>${escapeHtml(p.title)}</strong>
        <div class="meta">${new Date(p.createdAt).toLocaleString()}</div>
        <p>${escapeHtml(p.body)}</p>
        <div class="form-actions">
          <button data-id="${p.id}" class="delete">Delete</button>
        </div>
      `;
      const btn = row.querySelector('.delete');
      btn.addEventListener('click', async ()=>{
        if(!confirm('Delete this post?')) return;
        const r = await fetch(API_BASE + '/posts/' + p.id, { method: 'DELETE' });
        if(r.ok){
          await renderAdminPosts();
          await renderFeed();
        } else {
          alert('Delete failed');
        }
      });
      adminPosts.appendChild(row);
    });
  }

  // Show posts initially when authed
  if(await checkAuth()) renderAdminPosts();
  if(await checkAuth()) startPendingPoll();
    if(await checkAuth()) updateAdminPending();
    if(await checkAuth()) await renderAdminActivity();
}

  async function renderAdminActivity(){
    try{
      const res = await fetch(API_BASE + '/admin/activity', { credentials: 'include' });
      if(!res.ok) return;
      const arr = await res.json();
      const el = document.getElementById('admin-activity');
      if(!el) return;
      if(arr.length===0){ el.textContent='(no activity)'; return; }
      el.innerHTML='';
      arr.slice(0,20).forEach(a=>{
        const d = document.createElement('div'); d.className='meta card';
        d.innerHTML = `<strong>${escapeHtml(a.action)}</strong> <div class="meta">${new Date(a.createdAt).toLocaleString()}</div><div>${escapeHtml(a.details||'')}</div>`;
        el.appendChild(d);
      });
    }catch(e){ }
  }

let pendingPollTimer = null;
async function fetchPendingCount(){
  try{
    const res = await fetch(API_BASE + '/moderation/comments?status=unapproved', { credentials: 'include' });
    if(!res.ok) return 0;
    const arr = await res.json();
    return arr.length;
  }catch(e){ return 0; }
}

function updateBadge(count){
  const b = document.getElementById('pending-badge');
  if(!b) return;
  if(count>0){ b.style.display='inline-block'; b.textContent = count; } else { b.style.display='none'; }
}

function startPendingPoll(){
  if(pendingPollTimer) return;
  const run = async ()=>{ const c = await fetchPendingCount(); updateBadge(c); };
  run();
  pendingPollTimer = setInterval(run, 30000);
}

async function fetchPendingCountAdmin(){
  try{
    const res = await fetch(API_BASE + '/moderation/pending-count', { credentials: 'include' });
    if(!res.ok) return 0;
    const j = await res.json();
    return j.count || 0;
  }catch(e){ return 0; }
}

async function updateAdminPending(){
  const n = await fetchPendingCountAdmin();
  const el = document.getElementById('admin-pending');
  if(!el) return;
  if(n>0){ el.style.display='block'; el.textContent = `${n} comment(s) pending moderation — `; const a = document.createElement('a'); a.href='moderation.html'; a.textContent='Review'; el.innerHTML = ''; el.appendChild(document.createTextNode(`${n} comment(s) pending moderation — `)); el.appendChild(a); }
  else { el.style.display='none'; }
}

function showToast(msg, isError){
  let t = document.getElementById('site-toast');
  if(!t){ t = document.createElement('div'); t.id='site-toast'; t.style.position='fixed'; t.style.right='20px'; t.style.bottom='20px'; t.style.background='rgba(0,0,0,0.8)'; t.style.color='#fff'; t.style.padding='8px 12px'; t.style.borderRadius='6px'; t.style.zIndex=9999; document.body.appendChild(t); }
  t.textContent = msg; t.style.background = isError ? 'rgba(220,38,38,0.95)' : 'rgba(16,185,129,0.95)'; t.style.display='block'; setTimeout(()=>{ t.style.display='none'; }, 3500);
}

// Helpers
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function isYouTubeUrl(url){ return /youtube.com|youtu.be/.test(url); }
function convertYouTubeEmbed(url){
  // extract id
  const m = url.match(/(?:v=|v\/|embed\/|youtu\.be\/|watch\?v=)([A-Za-z0-9_-]{6,})/);
  const id = m ? m[1] : '';
  return id ? `https://www.youtube.com/embed/${id}` : url;
}

function storeFileAsDataUrl(file){
  return new Promise((res,rej)=>{
    const reader = new FileReader();
    reader.onload = ()=> res(reader.result);
    reader.onerror = ()=> rej(new Error('file read error'));
    reader.readAsDataURL(file);
  });
}

// Init on pages
window.addEventListener('DOMContentLoaded', ()=>{
  if(document.getElementById('feed')) renderFeed();
  if(document.getElementById('post-form')) initAdmin();
});

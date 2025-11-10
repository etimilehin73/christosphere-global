require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: parseInt(process.env.MAX_UPLOAD_BYTES || '104857600') } });

let db;
(async ()=>{
  // dynamic import for 'sqlite' (ES module); ensures open() is available
  let sqlite;
  try {
    sqlite = await import('sqlite');
  } catch (err) {
    console.error('Failed to import sqlite module:', err);
    process.exit(1);
  }
  const { open } = sqlite;
  db = await open({ filename: path.join(__dirname, 'data', 'app.db'), driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT,
    body TEXT,
    videoUrl TEXT,
    likes INTEGER DEFAULT 0,
    createdAt TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    postId TEXT,
    author TEXT,
    body TEXT,
    createdAt TEXT
  )`);
  // ensure moderation columns exist
  const cols = await db.all("PRAGMA table_info('comments')");
  const colNames = cols.map(c=>c.name);
  if(!colNames.includes('approved')){
    await db.run('ALTER TABLE comments ADD COLUMN approved INTEGER DEFAULT 1');
  }
  if(!colNames.includes('flags')){
    await db.run('ALTER TABLE comments ADD COLUMN flags INTEGER DEFAULT 0');
  }
  await db.exec(`CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY,
    postId TEXT,
    sessionId TEXT,
    createdAt TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    actor TEXT,
    action TEXT,
    targetType TEXT,
    targetId TEXT,
    details TEXT,
    createdAt TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    actor TEXT,
    action TEXT,
    targetType TEXT,
    targetId TEXT,
    details TEXT,
    createdAt TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY, passwordHash TEXT)`);
  // ensure admin exists (password from ENV)
  const row = await db.get('SELECT * FROM admin WHERE id=1');
  if(!row){
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    const h = await bcrypt.hash(pw, 10);
    await db.run('INSERT INTO admin(id, passwordHash) VALUES(1, ?)', h);
    console.log('Inserted admin user from env');
  }
})();

// Optional S3 client if configured
let s3Client = null;
if (process.env.AWS_S3_BUCKET && process.env.AWS_REGION) {
  s3Client = new S3Client({ region: process.env.AWS_REGION });
}

// optional email transporter
let mailer = null;
if(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ADMIN_EMAIL){
  mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT||587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}

app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  if(!password) return res.status(400).json({ error: 'missing' });
  const row = await db.get('SELECT * FROM admin WHERE id=1');
  if(!row) return res.status(500).json({ error: 'admin missing' });
  const ok = await bcrypt.compare(password, row.passwordHash);
  if(ok){ req.session.isAdmin = true; return res.json({ ok:true }); }
  res.status(401).json({ ok:false });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(()=>res.json({ ok: true }));
});

app.get('/api/auth', (req, res) => res.json({ authed: !!req.session.isAdmin }));

app.get('/api/posts', async (req, res) => {
  const posts = await db.all('SELECT * FROM posts ORDER BY datetime(createdAt) DESC');
  const sessionId = req.session.id;
  const out = [];
  for(const p of posts){
    const likedRow = await db.get('SELECT * FROM likes WHERE postId=? AND sessionId=?', p.id, sessionId);
    out.push(Object.assign({}, p, { liked: !!likedRow }));
  }
  res.json(out);
});

app.get('/api/posts/:id', async (req, res) => {
  const id = req.params.id;
  const post = await db.get('SELECT * FROM posts WHERE id = ?', id);
  if(!post) return res.status(404).json({ error: 'not found' });
  const likedRow = await db.get('SELECT * FROM likes WHERE postId=? AND sessionId=?', id, req.session.id);
  post.liked = !!likedRow;
  res.json(post);
});

app.post('/api/posts/:id/like', async (req, res) => {
  const id = req.params.id;
  const sessionId = req.session.id;
  const existing = await db.get('SELECT * FROM likes WHERE postId=? AND sessionId=?', id, sessionId);
  if(existing){
    // remove like
    await db.run('DELETE FROM likes WHERE id=?', existing.id);
    await db.run('UPDATE posts SET likes = COALESCE(likes,0) - 1 WHERE id = ?', id);
  } else {
    const lid = uuidv4();
    await db.run('INSERT INTO likes(id, postId, sessionId, createdAt) VALUES(?,?,?,?)', lid, id, sessionId, new Date().toISOString());
    await db.run('UPDATE posts SET likes = COALESCE(likes,0) + 1 WHERE id = ?', id);
  }
  const post = await db.get('SELECT likes FROM posts WHERE id = ?', id);
  const likedRow = await db.get('SELECT * FROM likes WHERE postId=? AND sessionId=?', id, sessionId);
  res.json({ likes: post.likes, liked: !!likedRow });
});

app.delete('/api/comments/:id', async (req, res) => {
  if(!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  const id = req.params.id;
  await db.run('DELETE FROM comments WHERE id=?', id);
  res.json({ ok: true });
});

app.get('/api/posts/:id/comments', async (req, res) => {
  const id = req.params.id;
  // only return approved comments to public
  const comments = await db.all('SELECT * FROM comments WHERE postId = ? AND COALESCE(approved,1)=1 ORDER BY datetime(createdAt) ASC', id);
  res.json(comments);
});

app.post('/api/posts/:id/comments', async (req, res) => {
  const id = req.params.id;
  const { author, body } = req.body;
  if(!body) return res.status(400).json({ error: 'missing body' });
  // moderation: if MODERATE_COMMENTS=1, mark as unapproved by default
  const moderate = process.env.MODERATE_COMMENTS === '1';
  const comment = { id: uuidv4(), postId: id, author: author || 'Anonymous', body, createdAt: new Date().toISOString(), approved: moderate ? 0 : 1, flags: 0 };
  await db.run('INSERT INTO comments(id, postId, author, body, createdAt, approved, flags) VALUES(?,?,?,?,?,?,?)', comment.id, comment.postId, comment.author, comment.body, comment.createdAt, comment.approved, comment.flags);
  // notify admin if moderation is enabled
  if(moderate && mailer){
    mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: process.env.ADMIN_EMAIL, subject: 'New comment pending moderation', text: `New comment on post ${id}\nAuthor: ${comment.author}\n${comment.body}` }).catch(()=>{});
  }
  res.json(comment);
});

// Moderation endpoints (admin only)
app.get('/api/moderation/comments', async (req, res) => {
  if(!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  // optional ?status=unapproved or ?status=all
  const status = req.query.status || 'unapproved';
  if(status === 'all'){
    const rows = await db.all('SELECT * FROM comments ORDER BY datetime(createdAt) DESC');
    return res.json(rows);
  }
  const rows = await db.all('SELECT * FROM comments WHERE COALESCE(approved,1)=0 ORDER BY datetime(createdAt) DESC');
  res.json(rows);
});

app.put('/api/comments/:id/approve', async (req, res) => {
  if(!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  const id = req.params.id;
  await db.run('UPDATE comments SET approved=1 WHERE id = ?', id);
  const c = await db.get('SELECT * FROM comments WHERE id=?', id);
  // record activity
  try{
    const aid = uuidv4();
    await db.run('INSERT INTO activity_log(id, actor, action, targetType, targetId, details, createdAt) VALUES(?,?,?,?,?,?,?)', aid, req.session.id || 'admin', 'approve_comment', 'comment', id, JSON.stringify({ author: c ? c.author : null }), new Date().toISOString());
  }catch(e){ /* ignore logging errors */ }
  res.json(c);
});

app.put('/api/comments/:id/reject', async (req, res) => {
  if(!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  const id = req.params.id;
  const c = await db.get('SELECT * FROM comments WHERE id=?', id);
  await db.run('DELETE FROM comments WHERE id=?', id);
  try{
    const aid2 = uuidv4();
    await db.run('INSERT INTO activity_log(id, actor, action, targetType, targetId, details, createdAt) VALUES(?,?,?,?,?,?,?)', aid2, req.session.id || 'admin', 'reject_comment', 'comment', id, JSON.stringify({ author: c ? c.author : null }), new Date().toISOString());
  }catch(e){ }
  res.json({ ok: true });
});

app.get('/api/moderation/pending-count', async (req, res) => {
  if(!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  const row = await db.get('SELECT COUNT(*) as c FROM comments WHERE COALESCE(approved,1)=0');
  res.json({ count: row.c });
});

app.post('/api/comments/:id/flag', async (req, res) => {
  const id = req.params.id;
  await db.run('UPDATE comments SET flags = COALESCE(flags,0) + 1 WHERE id = ?', id);
  const c = await db.get('SELECT * FROM comments WHERE id=?', id);
  res.json(c);
});

async function savePostToDb(post){
  await db.run('INSERT INTO posts(id,title,body,videoUrl,createdAt) VALUES(?,?,?,?,?)', post.id, post.title, post.body, post.videoUrl, post.createdAt);
}

app.post('/api/posts', upload.single('video'), async (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  const { title, body, videoUrl } = req.body;
  const c = await db.get('SELECT * FROM comments WHERE id=?', id);
  await db.run('DELETE FROM comments WHERE id=?', id);
  try{
    const aid3 = uuidv4();
    await db.run('INSERT INTO activity_log(id, actor, action, targetType, targetId, details, createdAt) VALUES(?,?,?,?,?,?,?)', aid3, req.session.id || 'admin', 'delete_comment', 'comment', id, JSON.stringify({ author: c ? c.author : null }), new Date().toISOString());
  }catch(e){ }
  res.json({ ok: true });
  if (req.file){

// Admin activity
app.get('/api/admin/activity', async (req, res) => {
  if(!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  const rows = await db.all('SELECT * FROM activity_log ORDER BY datetime(createdAt) DESC LIMIT 50');
  res.json(rows);
});
    if (s3Client){
      // upload to S3
      const key = `uploads/${req.file.filename}`;
      const fileStream = fs.createReadStream(req.file.path);
      await s3Client.send(new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key, Body: fileStream }));
      finalVideoUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
      // remove local file
      fs.unlinkSync(req.file.path);
    } else {
      finalVideoUrl = '/uploads/' + req.file.filename;
    }
  }

  const post = { id: uuidv4(), title, body, videoUrl: finalVideoUrl, createdAt: new Date().toISOString() };
  await savePostToDb(post);
  res.json(post);
});

app.delete('/api/posts/:id', async (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'not authed' });
  const id = req.params.id;
  const post = await db.get('SELECT * FROM posts WHERE id=?', id);
  if(!post) return res.status(404).json({ error: 'not found' });
  if(post.videoUrl && post.videoUrl.startsWith('/uploads/')){
    const fn = path.join(__dirname, post.videoUrl);
    try{ fs.unlinkSync(fn); }catch(e){}
  }
  await db.run('DELETE FROM posts WHERE id=?', id);
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOAD_DIR));

app.listen(PORT, ()=> console.log('Server listening on', PORT));

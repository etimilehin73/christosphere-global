# Christosphere Global Community (demo)

A small Node-backed demo that lets an admin publish text and video posts to a global feed.

Files:
- `index.html` - public feed
- `admin.html` - admin console
- `css/styles.css` - styles
- `js/app.js` - frontend logic (calls server API)
- `server.js` - Node/Express server for persistence and uploads
- `data/posts.json` - posts persisted here
- `uploads/` - uploaded video files

Quick start

1. Install dependencies:

   npm install

2. Start server:

   npm start

3. Open in browser:

   http://localhost:3000/index.html
   http://localhost:3000/admin.html

Credentials & notes

- Demo admin password: `admin123` (server-side). Replace with real auth for production.
- Uploaded videos are stored in `uploads/` and posts persisted to `data/posts.json`.
- For real global usage: add secure authentication, validation, rate limits, media hosting (S3/Cloud), and moderation.

Development

- Use `npm run dev` to start with `nodemon` for automatic reloads.

Security warning

This demo uses an insecure demo password and stores uploads locally. Do not run this as-is in production; follow secure practices for auth, file validation, and storage.

Quick deploy guide — show the app live

Goal
- Get the Express app running on a public URL so you can "see how it is when I go live".

Two recommended providers (fast, free tiers): Render or Railway. Below are one-click/manual steps you can follow. I can't deploy to your account from here, but I'll provide exact commands and copy-paste steps.

Required environment (.env)
Create a `.env` file with at least these values before first run (you can change these later in the provider's UI):

```
ADMIN_PASSWORD=admin123
SESSION_SECRET=change-this-secret
PORT=3000
MODERATE_COMMENTS=0
# Optional: AWS and SMTP if you want uploads or emails
# AWS_S3_BUCKET=your-bucket
# AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# SMTP_HOST=...
# SMTP_USER=...
# SMTP_PASS=...
# ADMIN_EMAIL=you@example.com
```

Option A — Deploy to Render (recommended)
1. Create a GitHub repo and push this project (see instructions below).
2. Sign in to https://render.com and create a new "Web Service".
   - Connect your GitHub account and select the repo.
   - Branch: `main` (or the branch you pushed).
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: set the `.env` variables in Render's dashboard (Environment -> Add Environment Variable).
   - Deploy.
3. Render will build and provide a public URL (https://<your-service>.onrender.com). Open that URL to see the app.
   
Render Auto-Deploy using the GitHub Action added in `.github/workflows/render-deploy.yml`:

- Create a service in Render first (manual), then copy its Service ID and create a Render API Key in your Render account (Dashboard -> Account -> API Keys).
- In your GitHub repo, go to Settings -> Secrets -> Actions and create two repository secrets:
  - `RENDER_SERVICE_ID` — the ID of the Render service you created (a string like `srv-xxxxx`).
  - `RENDER_API_KEY` — your personal Render API key.
- Push to `main` to trigger the GitHub Action which will call the Render deploy API and start a new deploy.

Notes:
- The `.render.yaml` manifest in the repo will help Render detect the service settings if you connect to the repo from Render's UI.
- The GitHub Action triggers a deploy via the Render REST API and requires the two secrets above.

Option B — Deploy to Railway
1. Create a GitHub repo and push the project.
2. Sign in to https://railway.app and create a new project -> Deploy from GitHub.
3. Select the repo and branch; Railway will detect Node and run `npm install` and `npm start` by default.
4. Add environment variables in Railway's dashboard, then deploy. Railway gives you a public URL.

Option C — Heroku (classic)
1. Install the Heroku CLI and login, create an app.
2. `git push heroku main` (or use GitHub integration).
3. Set config vars `heroku config:set ADMIN_PASSWORD=... SESSION_SECRET=...`.

Optional: Docker (works on most cloud providers)
- There's a `Dockerfile` included if you prefer to build a container and push to a container registry (Docker Hub, GitHub Container Registry) and deploy to Render (container) or other cloud providers.

Quick: Create a GitHub repo and push (PowerShell commands)
Run these from the project folder on your machine (you probably need to run them yourself — I can't push to your GitHub):

```powershell
cd 'C:\Users\USER\Desktop\christosphere project'
# initialize git repo if not already
if (-not (Test-Path .git)) { git init; git add .; git commit -m "Initial commit" }
# create a repo on GitHub (you can use gh CLI if installed) or create via web UI
# if you have the GitHub CLI (gh), you can run:
# gh repo create my-christosphere --public --source=. --remote=origin --push
# otherwise create a repo on github.com, then:
# git remote add origin https://github.com/<yourname>/<repo>.git
# git branch -M main
# git push -u origin main
```

After you deploy
- Paste the public URL here and I'll run a full E2E check (create a post, add a comment, like, test moderation, admin login).

If you want, I can also generate a small GitHub Actions workflow that deploys to Render automatically on push — tell me which provider and I will add the deploy config files.

Troubleshooting
- If the app fails to start, check logs in the provider's dashboard. Typical issues:
  - Missing `.env` variables (ADMIN_PASSWORD or SESSION_SECRET)
  - File upload permissions or missing `uploads/` dir (server creates it automatically in startup if writable)
  - Port environment variable — Render/Railway provide a port in `PORT`; our app reads `process.env.PORT` already.

If you want me to prepare a one-click GitHub Actions/Render manifest, say which provider and I will add it to the repo.
# DEPLOY.md — Deploying apps/web to Google Cloud Run

Monorepo deployment: only `apps/web` (Next.js 15) is deployed. The pipeline is
**GitHub → GitHub Actions → Artifact Registry → Cloud Run**, triggered on every
push to `main`. Cloud Run connects to Cloud SQL via its native Unix socket
connector — no auth proxy needed in production.

Work through the steps in order. Steps 1–3 are one-time GCP setup; Steps 4–5
add files to the repo; Step 6 is the first live deploy.

---

## Prerequisites

- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- Your GCP project already exists and billing is enabled
- Cloud SQL instance already exists (the one you connect to via `pnpm dev:cloud`)
- The repo is pushed to GitHub

Set these shell variables at the start of each terminal session — every command
below uses them:

```bash
PROJECT="your-gcp-project-id"
REGION="australia-southeast1"          # change to your Cloud SQL region
INSTANCE="visvine-pg"                  # your Cloud SQL instance name
SA="visvine-cloudrun@$PROJECT.iam.gserviceaccount.com"
REGISTRY="$REGION-docker.pkg.dev"
IMAGE="$REGISTRY/$PROJECT/visvine/web"
GITHUB_REPO="YOUR_GITHUB_USERNAME/Visvine"  # e.g. connorwiltshire/Visvine
```

---

## Step 1 — Enable GCP APIs and create infrastructure

Run once per GCP project.

```bash
# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  --project=$PROJECT

# Create Artifact Registry repository for Docker images
gcloud artifacts repositories create visvine \
  --repository-format=docker \
  --location=$REGION \
  --project=$PROJECT

# Create the service account Cloud Run will run as
gcloud iam service-accounts create visvine-cloudrun \
  --display-name="Visvine Cloud Run SA" \
  --project=$PROJECT

# Grant it Cloud SQL client access (for native socket connection)
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" \
  --role="roles/cloudsql.client"

# Grant it Secret Manager access (to read secrets at runtime)
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor"

# Grant it GCS access (for media/resource buckets)
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" \
  --role="roles/storage.objectAdmin"
```

---

## Step 2 — Cloud SQL: enable pgvector and create app user

Connect to the Cloud SQL instance (via Cloud Shell or your local auth proxy) and
run this once:

```sql
-- Create a dedicated app user (don't use the postgres superuser in prod)
CREATE USER visvine_app WITH PASSWORD 'strong-password-here';
GRANT ALL ON DATABASE visvine TO visvine_app;
```

Then push the Prisma schema to prod once from your local machine (with
`pnpm dev:cloud` pointing at Cloud SQL — see `docs/RUN.md` Mode B):

```bash
pnpm db:migrate   # prisma db push + apply-sql-functions.mjs
```

> **Warning:** `pnpm db:migrate` runs `prisma db push` which can drop columns
> without warning. Only run this when the schema change is intentional and
> reviewed. Never run `db:fresh`, `db:reset`, or `db:seed` against production.

---

## Step 3 — Create secrets in Secret Manager

Cloud Run reads secrets from Secret Manager at deploy time and injects them as
environment variables. Create one secret per value:

```bash
# Database URL — uses the Cloud SQL Unix socket path (no auth proxy in Cloud Run)
echo -n "postgresql://visvine_app:STRONG_PASSWORD@localhost/visvine?host=/cloudsql/$PROJECT:$REGION:$INSTANCE" \
  | gcloud secrets create DATABASE_URL --data-file=- --project=$PROJECT

# Auth secret — must match what was used to sign any existing sessions
echo -n "$(openssl rand -hex 32)" \
  | gcloud secrets create AUTH_SECRET --data-file=- --project=$PROJECT

# Google OAuth (from Google Cloud Console → APIs & Services → Credentials)
echo -n "your-google-client-id" \
  | gcloud secrets create GOOGLE_CLIENT_ID --data-file=- --project=$PROJECT

echo -n "your-google-client-secret" \
  | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=- --project=$PROJECT


# Web Push VAPID keys (optional — enables push notifications)
# Generate with: npx web-push generate-vapid-keys
echo -n "your-vapid-public-key" \
  | gcloud secrets create VAPID_PUBLIC_KEY --data-file=- --project=$PROJECT
echo -n "your-vapid-private-key" \
  | gcloud secrets create VAPID_PRIVATE_KEY --data-file=- --project=$PROJECT

# GCS private key (only needed if NOT using the attached service account for GCS)
# Inside GCP (Cloud Run) the attached SA handles GCS — leave GCS_CLIENT_EMAIL
# and GCS_PRIVATE_KEY unset and Cloud Run uses the runtime SA automatically.
```

To update a secret later:
```bash
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=- --project=$PROJECT
```

---

## Step 4 — Add files to the repo

### 4a — Enable Next.js standalone output

Edit `apps/web/next.config.ts` and add `output: "standalone"`. This makes
Next.js emit a self-contained `server.js` suitable for a Docker container:

```ts
const nextConfig: NextConfig = {
  output: "standalone",   // add this line
  images: {
    // ... existing config
  },
};
```

### 4b — Create `Dockerfile` at the repo root

The Dockerfile must be at the root (not inside `apps/web/`) because pnpm
workspaces need the full monorepo context to install correctly.

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Install dependencies ───────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
# Generate Prisma client before building
RUN pnpm --filter @visvine/web exec pnpm dlx prisma@7.4.0 generate
RUN pnpm --filter @visvine/web build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3080
ENV PORT=3080
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
```

### 4c — Create `.dockerignore` at the repo root

```
node_modules
.next
.git
apps/mobile
**/.env
**/.env.local
**/.env.prod-backup
**/.env.dev-backup
!**/.env.example
screenshots/
tmp/
```

### 4d — Create `.github/workflows/deploy.yml`

Replace the placeholder values at the top with your real project and region:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]

env:
  PROJECT: your-gcp-project-id
  REGION: australia-southeast1
  REGISTRY: australia-southeast1-docker.pkg.dev
  IMAGE: australia-southeast1-docker.pkg.dev/your-gcp-project-id/visvine/web
  SERVICE: visvine-web
  SQL_INSTANCE: your-gcp-project-id:australia-southeast1:visvine-pg

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # required for Workload Identity Federation

    steps:
      - uses: actions/checkout@v4

      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGISTRY }} --quiet

      - name: Build and push image
        run: |
          docker build -t ${{ env.IMAGE }}:${{ github.sha }} -t ${{ env.IMAGE }}:latest .
          docker push ${{ env.IMAGE }}:${{ github.sha }}
          docker push ${{ env.IMAGE }}:latest

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE }} \
            --image=${{ env.IMAGE }}:${{ github.sha }} \
            --region=${{ env.REGION }} \
            --platform=managed \
            --service-account=visvine-cloudrun@${{ env.PROJECT }}.iam.gserviceaccount.com \
            --add-cloudsql-instances=${{ env.SQL_INSTANCE }} \
            --set-secrets=DATABASE_URL=DATABASE_URL:latest,AUTH_SECRET=AUTH_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest \
            --set-env-vars=NEXT_PUBLIC_APP_URL=https://YOUR-CLOUD-RUN-URL,SUPER_ADMIN_EMAILS=cwnz2004@gmail.com,ENABLE_DEV_AUTH=false,VAPID_SUBJECT=mailto:hello@visvine.com \
            --min-instances=0 \
            --max-instances=10 \
            --memory=1Gi \
            --cpu=1 \
            --port=3080 \
            --allow-unauthenticated \
            --project=${{ env.PROJECT }}
```

> `NEXT_PUBLIC_APP_URL` must be the real Cloud Run URL. You get that URL after
> the first deploy — update this env var and redeploy once you have it. If you
> set up a custom domain, update it to that instead.

---

## Step 5 — Set up Workload Identity Federation (GitHub → GCP auth)

This lets GitHub Actions authenticate to GCP without storing a JSON key.
Run once:

```bash
# Create the WIF pool
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions pool" \
  --project=$PROJECT

# Create the OIDC provider inside the pool
gcloud iam workload-identity-pools providers create-oidc github \
  --workload-identity-pool=github-pool \
  --location=global \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$GITHUB_REPO'" \
  --project=$PROJECT

# Get the full pool resource name
POOL_NAME=$(gcloud iam workload-identity-pools describe github-pool \
  --location=global \
  --project=$PROJECT \
  --format="value(name)")

# Bind the GitHub repo to the service account
gcloud iam service-accounts add-iam-policy-binding $SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL_NAME/attribute.repository/$GITHUB_REPO" \
  --project=$PROJECT

# Print the provider resource name — you'll need this for the GitHub secret
gcloud iam workload-identity-pools providers describe github \
  --workload-identity-pool=github-pool \
  --location=global \
  --project=$PROJECT \
  --format="value(name)"
```

Then add two secrets to your **GitHub repo** (Settings → Secrets → Actions):

| Secret name | Value |
|---|---|
| `WIF_PROVIDER` | The provider resource name printed by the last command above |
| `WIF_SERVICE_ACCOUNT` | `visvine-cloudrun@YOUR_PROJECT.iam.gserviceaccount.com` |

---

## Step 6 — First deploy

1. Commit and push all the new files (`next.config.ts` change, `Dockerfile`,
   `.dockerignore`, `.github/workflows/deploy.yml`) to `main`.
2. Watch the Actions tab on GitHub — the workflow will build the Docker image
   and deploy to Cloud Run.
3. After the first deploy succeeds, **grab the Cloud Run service URL** from the
   GCP Console (Cloud Run → `visvine-web` → URL at the top).
4. Update `NEXT_PUBLIC_APP_URL` on the Cloud Run service to that URL:
   ```bash
   gcloud run services update visvine-web \
     --region=$REGION \
     --update-env-vars=NEXT_PUBLIC_APP_URL=https://YOUR-REAL-URL.a.run.app \
     --project=$PROJECT
   ```
5. Add the Cloud Run URL to your Google OAuth client's **Authorized redirect URIs**
   in Google Cloud Console → APIs & Services → Credentials:
   - `https://YOUR-URL.a.run.app/api/auth/callback/google`
   - `https://YOUR-URL.a.run.app/api/auth/callback/google-mobile`

---

## Post-deploy: custom domain (optional)

```bash
# Map a custom domain (must verify domain ownership in Search Console first)
gcloud run domain-mappings create \
  --service=visvine-web \
  --domain=app.yourdomain.com \
  --region=$REGION \
  --project=$PROJECT
```

Then update `NEXT_PUBLIC_APP_URL` to `https://app.yourdomain.com` and update
the OAuth redirect URIs to match.

---

## Quick reference: local vs production

| | Local dev | Cloud Run |
|---|---|---|
| Database connection | Auth proxy on `127.0.0.1:5432` | Native Unix socket `/cloudsql/project:region:instance` |
| Database URL | `postgresql://postgres:postgres@localhost:5432/visvine` | `postgresql://visvine_app:PASS@localhost/visvine?host=/cloudsql/...` |
| Auth | `/dev/login` bypass | Google OAuth only |
| `ENABLE_DEV_AUTH` | `true` | `false` |
| GCS credentials | ADC from `gcloud auth application-default login` | Attached service account (no key needed) |
| Secrets | `apps/web/.env` file | Secret Manager → injected by Cloud Run |

## Updating secrets after deploy

```bash
# Add a new version of an existing secret
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=- --project=$PROJECT

# Cloud Run picks up :latest automatically on next deploy.
# To force an immediate update without a code change:
gcloud run services update visvine-web --region=$REGION --project=$PROJECT
```

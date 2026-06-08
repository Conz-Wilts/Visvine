# CUSTOM_DOMAIN.md — Mapping visvine.com to Cloud Run

`australia-southeast1` does not support Cloud Run domain mappings, so the
correct approach is a **Global External Application Load Balancer** with a
serverless NEG backend. This also gives you a static IP, Google-managed SSL,
and optional Cloud CDN.

Work through the steps in order. Steps 1–4 are one-time GCP setup; Steps 5–7
update app config to match the new domain.

---

## Prerequisites

- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- The Cloud Run service `visvine-web` is already deployed and working on its
  `.run.app` URL
- You control the DNS for `visvine.com` (registrar or Cloudflare, etc.)

Set these shell variables at the start of your terminal session:

```bash
PROJECT="visvine-platform"
REGION="australia-southeast1"
SERVICE="visvine-web"
```

---

## Step 1 — Reserve a static external IP

```bash
gcloud compute addresses create visvine-ip \
  --global --project=$PROJECT

# Note the address — you'll need it for DNS in Step 5
gcloud compute addresses describe visvine-ip \
  --global --project=$PROJECT --format="value(address)"
```

---

## Step 2 — Create a serverless NEG pointing at Cloud Run

```bash
gcloud compute network-endpoint-groups create visvine-neg \
  --region=$REGION \
  --network-endpoint-type=serverless \
  --cloud-run-service=$SERVICE \
  --project=$PROJECT
```

---

## Step 3 — Build the HTTPS load balancer

```bash
# Backend service
gcloud compute backend-services create visvine-backend \
  --global --project=$PROJECT

gcloud compute backend-services add-backend visvine-backend \
  --global \
  --network-endpoint-group=visvine-neg \
  --network-endpoint-group-region=$REGION \
  --project=$PROJECT

# URL map
gcloud compute url-maps create visvine-urlmap \
  --default-service=visvine-backend \
  --project=$PROJECT

# Google-managed SSL cert (covers apex + www)
gcloud compute ssl-certificates create visvine-cert \
  --domains=visvine.com,www.visvine.com \
  --global --project=$PROJECT

# HTTPS proxy + forwarding rule
gcloud compute target-https-proxies create visvine-https-proxy \
  --url-map=visvine-urlmap \
  --ssl-certificates=visvine-cert \
  --global --project=$PROJECT

gcloud compute forwarding-rules create visvine-https-rule \
  --global \
  --target-https-proxy=visvine-https-proxy \
  --address=visvine-ip \
  --ports=443 \
  --project=$PROJECT
```

---

## Step 4 — HTTP → HTTPS redirect

```bash
gcloud compute url-maps import visvine-http-redirect \
  --global --project=$PROJECT --source=- << 'EOF'
name: visvine-http-redirect
defaultUrlRedirect:
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
  httpsRedirect: true
EOF

gcloud compute target-http-proxies create visvine-http-proxy \
  --url-map=visvine-http-redirect \
  --global --project=$PROJECT

gcloud compute forwarding-rules create visvine-http-rule \
  --global \
  --target-http-proxy=visvine-http-proxy \
  --address=visvine-ip \
  --ports=80 \
  --project=$PROJECT
```

---

## Step 5 — Point DNS to the static IP

At your DNS registrar or nameserver, add:

| Type | Name       | Value            |
|------|------------|------------------|
| `A`  | `@` (apex) | `<static IP>`    |
| `A`  | `www`      | `<static IP>`    |

SSL certificate provisioning begins as soon as DNS resolves to the load
balancer IP. It typically takes **15 minutes to 2 hours** but can be up to 24h.
The certificate transitions `PROVISIONING → ACTIVE` — check with:

```bash
gcloud compute ssl-certificates describe visvine-cert \
  --global --project=$PROJECT --format="value(managed.status,managed.domainStatus)"
```

Do not proceed to Step 6 until the cert is `ACTIVE`.

---

## Step 6 — Update NEXT_PUBLIC_APP_URL

**Live service** (takes effect immediately, no redeploy needed):

```bash
gcloud run services update $SERVICE \
  --region=$REGION \
  --update-env-vars=NEXT_PUBLIC_APP_URL=https://visvine.com \
  --project=$PROJECT
```

**`.github/workflows/deploy.yml`** (so future deploys don't overwrite it):

```diff
- NEXT_PUBLIC_APP_URL=https://visvine-web-612301752988.australia-southeast1.run.app
+ NEXT_PUBLIC_APP_URL=https://visvine.com
```

---

## Step 7 — Update Google OAuth redirect URIs

In GCP Console → APIs & Services → Credentials → your OAuth 2.0 client, add:

- `https://visvine.com/api/auth/callback/google`
- `https://visvine.com/api/auth/callback/google-mobile`

Once you've confirmed login works on the custom domain you can remove the old
`.run.app` redirect URIs.

---

## What does not need changing

- The `.run.app` Cloud Run URL stays valid — the load balancer is a front door,
  not a replacement. Secrets, the Docker build, and Cloud SQL config are
  unchanged.
- `GCS_CDN_BASE_URL` is already set in `deploy.yml` so media images bypass
  Cloud Run. No change needed.

---

## Optional: redirect www → apex

If you want `www.visvine.com` to 301-redirect to `visvine.com` at the load
balancer layer, replace the URL map with one that has a path matcher:

```bash
gcloud compute url-maps import visvine-urlmap \
  --global --project=$PROJECT --source=- << 'EOF'
name: visvine-urlmap
defaultService: projects/visvine-platform/global/backendServices/visvine-backend
hostRules:
  - hosts: ["visvine.com"]
    pathMatcher: default
  - hosts: ["www.visvine.com"]
    pathMatcher: www-redirect
pathMatchers:
  - name: default
    defaultService: projects/visvine-platform/global/backendServices/visvine-backend
  - name: www-redirect
    defaultUrlRedirect:
      hostRedirect: visvine.com
      redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
      stripQuery: false
EOF
```

---

## Reference: quick-check commands

```bash
# Static IP address
gcloud compute addresses describe visvine-ip --global --project=$PROJECT --format="value(address)"

# SSL cert status
gcloud compute ssl-certificates describe visvine-cert --global --project=$PROJECT \
  --format="value(managed.status,managed.domainStatus)"

# Current Cloud Run env vars
gcloud run services describe $SERVICE --region=$REGION --project=$PROJECT \
  --format="value(spec.template.spec.containers[0].env)"
```

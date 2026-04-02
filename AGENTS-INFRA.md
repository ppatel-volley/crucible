# Infrastructure Deployment Guide

> How to deploy applications to Volley's Kubernetes infrastructure.
> Read this when working on Docker, CI/CD, deployment, infrastructure, or Kubernetes tasks.

---

## Overview

Volley runs applications on an **AWS EKS (Kubernetes) cluster** managed via **Flux GitOps**. Deploying an application requires:

1. A runnable **Docker image** pushed to ECR
2. **IAM roles** for AWS resource access
3. **Helm releases** defining the K8s deployment
4. **Flux configs** for automated deployments

---

## Key Repositories

| Repository | Purpose | When to use |
|-----------|---------|-------------|
| [volley-infra](https://github.com/Volley-Inc/volley-infra) | AWS resources via Terraform (Atlantis). IAM roles, Redis clusters, ECR repos, etc. | Creating AWS resources, adjusting IAM permissions |
| [volley-infra-tenants](https://github.com/Volley-Inc/volley-infra-tenants) | Helm releases and K8s manifests for all deployed apps | Configuring app deployments (env vars, resources, scaling, secrets, hostnames) |
| [kubernetes](https://github.com/Volley-Inc/kubernetes) | Flux configs, namespace creation, RBAC, alerting | Onboarding new apps, setting up CD automation |
| [helm-charts](https://github.com/Volley-Inc/helm-charts) | Shared Helm charts (e.g. `app` chart at `charts/app/0.1.1`) | Reference only — used by helm releases |

---

## Docker Image Requirements

### Dockerfile Pattern (VGF monorepo — prototypes)

For prototype deployments via `crucible prototype --docker`, VGF games use this pattern:

```
Stage 1: base        → node:22-slim + pnpm (corepack enable)
Stage 2: build       → Copy package.json files + pnpm install + copy source + build ALL packages
Stage 3: production  → Copy full workspace, run with tsx
```

**Reference Dockerfile:**
```dockerfile
FROM node:22-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/display/package.json apps/display/
COPY apps/controller/package.json apps/controller/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=secret,id=npm_token NPM_TOKEN=$(cat /run/secrets/npm_token) pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter=@<game>/shared build \
    && pnpm --filter=@<game>/server build \
    && pnpm --filter=@<game>/display build \
    && pnpm --filter=@<game>/controller build

FROM base AS production
WORKDIR /app
COPY --from=build /app ./
EXPOSE 8080
CMD ["./apps/server/node_modules/.bin/tsx", "apps/server/src/dev.ts"]
```

**Critical details:**
- **Always build with `--platform linux/amd64`** — EKS nodes are x86_64. Builds on Apple Silicon (ARM) produce images that fail with `ImagePullBackOff` / "no match for platform in manifest" if the platform is not specified.
- Use `--mount=type=secret,id=npm_token` for `@volley` private package auth during install. The secret is mounted as a file at `/run/secrets/npm_token` — the Dockerfile `RUN` step must read it into the `NPM_TOKEN` env var: `NPM_TOKEN=$(cat /run/secrets/npm_token) pnpm install --frozen-lockfile`
- **Build ALL workspace packages** (shared, server, display, controller) — the server must serve display/controller as static files. Without them, Proto-Hub shows a black screen.
- **Use `tsx` to run the server** — games use `moduleResolution: "bundler"` which produces extensionless imports. Node.js ESM rejects these. `tsx` handles the resolution.
- **Do NOT use `pnpm deploy --prod`** for prototypes — it strips devDependencies (including `tsx`) and the ESM resolution issue means compiled JS won't run under plain `node`.
- The server must serve static display/controller builds via Express middleware and auto-create sessions on demand (Proto-Hub sends its own sessionId).
- Deploy command: `crucible prototype <game-id> --docker --port 8090` (no `--ws-port` — VGF serves HTTP + WS on one port)
- Expose port **8080** (production default) or **8090** (VGF dev server default)

### `.npmrc` for Private Packages

Required at project root for Docker builds to access `@volley/*` packages:

```
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

The `NPM_TOKEN` is passed as a Docker build secret, **not** a build arg (secrets don't leak into image layers).

### ECR Registry

All images are pushed to: `375633680607.dkr.ecr.us-east-1.amazonaws.com`

Image names follow the pattern: `375633680607.dkr.ecr.us-east-1.amazonaws.com/<app-name>:<tag>`

Tags follow: `<branch>-<short-sha>-<timestamp>`

---

## CI/CD Workflow

### GitHub Actions CD (`.github/workflows/cd.yml`)

Triggered on push to `main`. Steps:
1. Checkout code
2. Login to ECR using `AWS_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY` secrets
3. Build Docker image with `NPM_TOKEN` secret
4. Push to ECR with tag `main-<sha>-<timestamp>`

**Required GitHub Secrets:**
- `AWS_ACCESS_KEY` — ECR push access
- `AWS_SECRET_ACCESS_KEY` — ECR push access
- `NPM_TOKEN` — npmjs.org token for `@volley` private packages

### Flux Automatic Image Updates

Once configured in the [kubernetes](https://github.com/Volley-Inc/kubernetes) repo, Flux watches for new images in ECR and automatically updates the helm release in volley-infra-tenants, triggering a rolling deployment.

---

## Onboarding a New Application (Step by Step)

### Step 1: Create ECR Repository

**Repo:** `volley-infra` (Terraform PR)

Create an ECR repository for storing Docker images. Submit a PR to the terraform directory.

### Step 2: Create IAM Roles

**Repo:** `volley-infra` (Terraform PR)

Create IAM roles for dev, staging, and prod environments. These roles use OIDC to allow the EKS cluster's service accounts to assume them. Attach policies for any AWS resources the app needs (S3, Lambda, etc.).

### Step 3: Add Helm Release Configs

**Repo:** `volley-infra-tenants`

Add helm release files for each environment (dev, staging, prod). These configure:
- **Hostname** (internal or public)
- **Resource requests/limits** (CPU, memory)
- **Autoscaling** (min/max replicas, target CPU)
- **Environment variables**
- **Secrets** (via SecretProviderClass from AWS Secrets Manager)
- **Service account annotations** (IAM role ARN)

Example structure:
```
<app-name>/kubernetes/
├── dev/
│   ├── config.yaml          # Helm release values
│   └── secret-provider-class.yaml
├── staging/
│   ├── config.yaml
│   └── secret-provider-class.yaml
└── production/
    ├── config.yaml
    └── secret-provider-class.yaml
```

### Step 4: Create Flux Configs and Namespaces

**Repo:** `kubernetes`

Run the provided scripts to generate:

| File | Purpose |
|------|---------|
| `<app>-image-auto-update.yaml` | Flux automatic image update config (CD trigger) |
| `sync.yaml` | Flux kustomization — what to deploy in each namespace |
| `rbac.yaml` | RBAC for developer access to namespaces |
| `alertmanagerconfig.yaml` | Prometheus alerting for the namespaces |
| `slack-<app>-notifications.yaml` | Flux notification provider for Slack |
| `notification-info.yaml` | Flux alert config per namespace |

---

## Naming Conventions

**IMPORTANT:** Different systems use different conventions for the production environment. Getting these wrong will cause IAM policy mismatches or pods failing to start.

| System | Dev | Staging | Production | Example |
|--------|-----|---------|------------|---------|
| K8s namespace | `{app}-dev` | `{app}-staging` | `{app}-production` | `emoji-multiplatform-production` |
| IAM role name | `{app}-dev` | `{app}-staging` | `{app}-production` | `emoji-multiplatform-production` |
| SSM parameter path | `/app/dev/*` | `/app/staging/*` | **`/app/prod/*`** | `/emoji-multiplatform/prod/*` |
| Terraform `environment` var | `dev` | `staging` | `prod` or `production` (varies) | Check existing app |
| Helm `STAGE` env var | `dev` | `staging` | `production` | — |
| Helm `DD_ENV` env var | `dev` | `staging` | `production` | — |
| Config directory (tenants) | `kubernetes/dev/` | `kubernetes/staging/` | `kubernetes/production/` | — |

The SSM path uses **`/prod/`** (abbreviated), not `/production/`. This must match in both the IAM policy (`iam.tf`) and the `SecretProviderClass` (`secret-provider-class.yaml`).

---

## EKS Clusters and OIDC

There are two EKS clusters. Each environment maps to a specific cluster and OIDC issuer:

| Cluster | OIDC Issuer ID | Environments | kubernetes repo directory |
|---------|---------------|--------------|--------------------------|
| Production (`shared-k8s`) | `01E696BE35164FB79F396D5B1F5D6FBC` | production | `tenants/shared-k8s/` |
| Dev/Staging (`shared-k8s-staging`) | `EA6668ABEDE0D8F73A1A994FAB6EF125` | dev, staging | `tenants/shared-k8s-staging/` |

**In Terraform**, the OIDC variable name changes per environment:
- Production: `oidc_issuer`
- Dev: `oidc_issuer_dev`
- Staging: `oidc_issuer_staging`

**In the IAM module**, newer apps use `provider_urls = [var.oidc_issuer]` (list form). Older apps use `provider_url` (singular). Use the list form for new apps.

---

## Secrets via SSM Parameter Store

Secrets are stored in **AWS Systems Manager Parameter Store** (not AWS Secrets Manager). The flow:

1. Store secret as `SecureString` in SSM: `/app-name/{env}/secret_name`
2. IAM policy grants `ssm:GetParameter` on `parameter/app-name/{env}/*`
3. `SecretProviderClass` in volley-infra-tenants maps SSM params to K8s secrets
4. Helm release references the K8s secret via `envFrom.secretRef` and CSI volume mount

**Creating SSM parameters:**
```bash
aws ssm put-parameter \
  --name "/app-name/dev/my_secret" \
  --value "secret-value" \
  --type SecureString \
  --region us-east-1
```

**Critical:** Only reference SSM parameters in `SecretProviderClass` that actually exist. If a parameter doesn't exist, the pod will fail to start.

---

## Environment Variables (This Project)

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `NODE_ENV` | `production` | No | Runtime environment |
| `PORT` | `8080` | No | Server port |
| `REDIS_URL` | `redis://localhost:6379` | Yes (prod) | Redis connection |
| `LOG_LEVEL` | `info` | No | Logging verbosity |
| `CORS_ORIGIN` | `https://play.volley.tv` | No | Allowed CORS origins (comma-separated) |
| `SHUTDOWN_TIMEOUT` | `25000` | No | Graceful shutdown timeout (ms) |
| `STAGE` | `production` | No | Deployment stage |
| `DATABASE_URL` | — | No | Database connection string |
| `AMPLITUDE_API_KEY` | — | No | Analytics |
| `SEGMENT_WRITE_KEY` | — | No | Analytics |
| `CODE_MAP_CREATE_URL` | `https://auth.volley.tv/code-map` | No | Room code service |
| `CODE_MAP_RESOLVE_URL` | `https://auth.volley.tv/code-map` | No | Room code service |
| `DD_ENV` | — | No | Enables Datadog APM tracing when set |

---

## Common Tasks

### Updating environment variables
Submit a PR to `volley-infra-tenants` modifying the relevant `config.yaml`.

### Adjusting resource limits or scaling
Submit a PR to `volley-infra-tenants` modifying `resources` or `autoscaling` in `config.yaml`.

### Adjusting IAM permissions
Submit a PR to `volley-infra` modifying the Terraform IAM policy attachments.

### Adding secrets
1. Store the secret in **AWS SSM Parameter Store** as `SecureString` (see [Secrets via SSM Parameter Store](#secrets-via-ssm-parameter-store))
2. Grant IAM access to the parameter path in `volley-infra` (`iam.tf`)
3. Add a `SecretProviderClass` entry in `volley-infra-tenants`
4. Reference the K8s secret via `envFrom.secretRef` in the helm release `config.yaml`

### Getting help
Post in **#infra-support** Slack channel.

---

## Keyword Triggers

When a task involves any of these keywords, read this document:
`docker`, `dockerfile`, `container`, `kubernetes`, `k8s`, `deploy`, `deployment`, `ecr`, `helm`, `flux`, `infrastructure`, `infra`, `iam`, `eks`, `ci/cd`, `cd.yml`, `production build`, `docker image`

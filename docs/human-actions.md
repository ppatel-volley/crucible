# Human Actions — What You Need to Do (and How)

> **Why this exists:** Phase 2+ is blocked because some things need a human with the right access to set up. AI agents can't create AWS resources, DNS records, or SSO clients. This doc walks you through each one in plain English.
>
> **Do them in order.** Each section says what it unblocks.

---

## 1. AWS Access

**What:** Create the cloud resources that store game images, client files, and the game registry database.

**Who:** Pratik, using the **CrucibleAdmin** SSO permission set (created via [volley-infra PR #2094](https://github.com/Volley-Inc/volley-infra/pull/2094)).

**Unblocks:** Almost all of Phase 2. This is the biggest bottleneck.

> **Note:** The CrucibleAdmin permission set covers ECR, S3, DynamoDB, CloudFormation, CloudFront, API Gateway, and Lambda — all scoped to `crucible-*` resources. IAM roles/policies and OIDC provider are managed via Terraform (see section 1d below).

### 1a. Container Registry (ECR)

This is where Docker images of games get stored. Think of it as a private Docker Hub.

1. Go to **AWS Console → ECR → Create Repository**
2. Name: `crucible-games`
3. Turn on **Scan on push** (it checks images for security vulnerabilities)
4. Add a lifecycle policy:
   - Keep the last **50** tagged images
   - Delete **untagged** images after **7 days**

**How you know it worked:** `aws ecr describe-repositories --repository-names crucible-games` returns something.

### 1b. S3 Buckets (Client Assets)

These store the compiled JavaScript/HTML for the TV display and phone controller. One bucket per environment so dev experiments can't break production.

Create **3 buckets** — do this for each:

| Bucket Name | Environment |
|-------------|-------------|
| `crucible-clients-dev` | Development |
| `crucible-clients-staging` | Staging |
| `crucible-clients-prod` | Production |

For each bucket:
1. Go to **AWS Console → S3 → Create Bucket**
2. Use the name from the table
3. Region: `us-east-1` (or wherever your other stuff lives)
4. After creation, go to **Properties → Bucket Versioning → Enable**

Versioning means if someone pushes a bad build, the old files are still there and can be restored.

**How you know it worked:** `aws s3 ls` shows all three buckets.

### 1c. DynamoDB Tables (Game Registry)

This is the database that tracks which games exist, what version they're on, and whether they're healthy. Two tables:

**Table 1: `crucible-catalog`**
1. Go to **AWS Console → DynamoDB → Create Table**
2. Table name: `crucible-catalog`
3. Partition key: `gameId` (String)
4. Use default settings (on-demand capacity is fine)
5. After creation:
   - Go to **Additional settings → Point-in-time recovery → Turn on** (this is your "undo" for the database)
   - Go to **Additional settings → Time to Live → Enable** with attribute name `expiresAt`
6. Create a GSI (Global Secondary Index):
   - Index name: `author-index`
   - Partition key: `author` (String)

**Table 2: `crucible-versions`**
1. Same process — create table
2. Table name: `crucible-versions`
3. Partition key: `gameId` (String)
4. Sort key: `version` (String)
5. Turn on Point-in-time recovery
6. Turn on TTL with attribute name `expiresAt`

**How you know it worked:** `aws dynamodb list-tables` shows both tables.

### 1d. GitHub OIDC + IAM Role (CI Authentication)

> **DO NOT create IAM roles/policies from the AWS console.** They must be created via Terraform in the `volley-infra` repo. Console-based IAM write access enables privilege escalation (creating a policy with `Action: "*"` and attaching it to a role you can assume).

This lets GitHub Actions deploy games to AWS without storing any AWS credentials in GitHub.

**How to do it:**
1. Create a new Terraform file in `volley-infra` (e.g. `aws/us-east-1/crucible/iam.tf`)
2. Define the GitHub OIDC provider (if not already present), the `crucible-ci` role with trust policy, and the `crucible-ci-policy` with scoped permissions
3. Submit as a PR — the review bots will check for escalation paths
4. Get it reviewed and merged via Atlantis

**What the Terraform should create:**
- GitHub OIDC provider (if not already in the account)
- `crucible-ci` IAM role with trust policy scoped to `repo:Volley-Inc/crucible-game-*:ref:refs/heads/main`
- `crucible-ci-policy` with permissions for: ECR push/pull, S3 put to `crucible-clients-*`, DynamoDB CRUD on `crucible-*`, EKS DescribeCluster, CloudFormation for IRSA stacks

**How you know it worked:** `aws iam get-role --role-name crucible-ci` returns the role. Note down the ARN for the GitHub Actions workflow.

---

## 2. Kubernetes Admin

**What:** Create the namespaces where game containers will run, and verify that KEDA (auto-scaling) and Cilium (network security) are installed.

**Who:** Anyone with `kubectl` admin access to the Volley EKS cluster.

**Unblocks:** Phase 2B (K8s resources), which unblocks Phase 3 (deploy pipeline).

### 2a. Create Namespaces

Games run in isolated namespaces — one per environment. The Pod Security Standard label means containers can't run as root or do dodgy things.

```bash
# Create three namespaces
for env in dev staging prod; do
  kubectl create namespace crucible-${env}
  kubectl label namespace crucible-${env} \
    pod-security.kubernetes.io/enforce=restricted \
    pod-security.kubernetes.io/warn=restricted
done
```

**How you know it worked:** `kubectl get namespaces | grep crucible` shows all three.

### 2b. Verify KEDA is Installed

KEDA scales games down to zero replicas when nobody's playing (saves money) and back up when someone connects.

```bash
kubectl get crd | grep scaledobjects.keda.sh
```

If that returns a result, KEDA is installed. If not, install it:
```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace
```

**How you know it worked:** `kubectl get pods -n keda` shows running KEDA pods.

### 2c. Verify Cilium is Installed

Cilium handles network security — it prevents games from talking to things they shouldn't (other games' Redis, internal services, etc.).

```bash
cilium status
```

If that works and shows "OK", Cilium is installed. If not, talk to whoever manages the cluster networking — Cilium is usually installed at cluster creation time and isn't something you bolt on casually.

**How you know it worked:** `cilium status` shows all green.

---

## 3. DNS Records

**What:** Point domain names at the right AWS resources so games are accessible at nice URLs instead of random CloudFront/ALB addresses.

**Who:** Whoever manages DNS for `volley.tv` and `volley-services.net` (probably Route53 or Cloudflare).

**Unblocks:** CloudFront distributions (2A.3), game server routing (2B.7).

Create these **6 DNS records** (all CNAME):

| Record | Points To | Purpose |
|--------|-----------|---------|
| `crucible-clients-dev.volley.tv` | CloudFront distribution for dev bucket | Dev client assets |
| `crucible-clients-staging.volley.tv` | CloudFront distribution for staging bucket | Staging client assets |
| `crucible-clients-prod.volley.tv` | CloudFront distribution for prod bucket | Prod client assets |
| `crucible-games-dev.volley-services.net` | EKS ALB (dev) | Dev game server traffic |
| `crucible-games-staging.volley-services.net` | EKS ALB (staging) | Staging game server traffic |
| `crucible-games-prod.volley-services.net` | EKS ALB (prod) | Prod game server traffic |

**Note:** You'll create the CloudFront distributions as part of Phase 2A.3 (an agent can do that once the S3 buckets exist). The ALB already exists if your EKS cluster has an ingress controller. You just need the DNS records pointing to them.

**How you know it worked:** `nslookup crucible-clients-dev.volley.tv` resolves to something.

---

## 4. SSO / OIDC Config

**What:** Register Crucible as an application in the Volley SSO provider so `crucible login` can authenticate users.

**Who:** Whoever manages the SSO/identity provider (Okta, Auth0, Azure AD, etc.).

**Unblocks:** `crucible login`, Proto-Hub auth (Phase 4).

**Can be deferred:** You don't need this until you're ready to test publishing or Proto-Hub. Local dev (`crucible create`, `crucible dev`, `crucible agent`) works without auth.

### What to set up

Create a new OIDC client application:

| Setting | Value |
|---------|-------|
| Client Name | `crucible-cli` |
| Client Type | Public (no client secret — it's a CLI) |
| Grant Types | `authorization_code` (with PKCE) + `urn:ietf:params:oauth:grant-type:device_code` |
| Redirect URIs | `http://127.0.0.1:*/callback` (the `*` is important — CLI uses an ephemeral port) |
| Scopes | `openid`, `email`, `profile` |
| Access Token Lifetime | 1 hour |
| Refresh Token Lifetime | 30 days |

### What to give back to the agents

Once created, provide these three values — they'll be baked into the CLI config:

1. **Issuer URL** — e.g. `https://auth.volley.tv` or `https://volley.okta.com/oauth2/default`
2. **Client ID** — e.g. `0oa1b2c3d4e5f6g7h8`
3. **Device Auth Endpoint** — e.g. `https://auth.volley.tv/oauth2/device/authorize`

**How you know it worked:** Opening the issuer URL + `/.well-known/openid-configuration` in a browser shows a JSON document with all the endpoints.

---

## 5. Redis Admin (Lower Priority)

**What:** Set up per-game Redis ACL users so games can't read each other's data.

**Who:** Whoever manages the Volley Redis cluster (ElastiCache or self-hosted).

**Unblocks:** Phase 2D.1 only. Can be done later.

**Can be deferred:** Games work fine with a shared Redis connection for now. This is a security hardening step.

For each game, create a Redis user scoped to that game's key prefix:
```
ACL SETUSER crucible-game-scottish-trivia on >generated-password ~scottish-trivia:* &scottish-trivia:* +@all
```

This will eventually be automated by a Lambda function. For now, you just need to confirm:
1. Your Redis cluster supports ACLs (Redis 6+)
2. You have admin access to create users

---

## 6. Not Needed Yet

These are blocked but won't matter for months:

- **Hub repo access** — Needed to fork Hub into Proto-Hub (Phase 4). Do this when Phase 3 is done.
- **Code signing certificates** — Needed for desktop app auto-update (Phase 6). Way down the line.

---

## Quick Reference: What Unblocks What

```
AWS Access ──→ 2A (ECR, S3, DynamoDB, IAM) ──→ 2C (Registry API) ──→ Phase 3 (Publish)
K8s Admin  ──→ 2B (Namespaces, KEDA, Cilium) ──→ Phase 3 (Deploy)
DNS Access ──→ 2A.3 + 2B.7 (CloudFront, ALB routing)
SSO Config ──→ crucible login ──→ publish auth, Proto-Hub auth
Redis      ──→ 2D.1 (security hardening, can defer)
```

**Start with AWS access and K8s admin — those two unblock 90% of the remaining work.**

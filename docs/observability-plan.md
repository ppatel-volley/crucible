# Crucible Observability Plan — Datadog

> **Date:** 2026-03-31
> **Status:** Proposal

---

## Overview

Crucible has four surfaces that need observability:

| Surface | Type | Where | What to Monitor |
|---------|------|-------|-----------------|
| **Registry API** | Lambda + API Gateway | AWS | Latency, errors, DynamoDB ops, 4xx/5xx rates |
| **Game Server Pods** | K8s containers (VGF) | EKS | CPU/memory, Socket.IO connections, phase transitions, crashes |
| **Bifrost Prototypes** | K8s containers (Buildpack) | EKS | Build times, pod health, dependency provisioning |
| **CLI** | Local Node.js | Developer machines | (optional) Error telemetry, usage metrics |

---

## 1. Registry API (Lambda)

### Instrumentation

Add the Datadog Lambda layer for automatic instrumentation. No code changes needed — the layer wraps the handler:

```hcl
# In terraform/crucible-registry/lambda.tf
resource "aws_lambda_function" "registry" {
  ...
  layers = [
    "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:latest"
  ]

  environment {
    variables = {
      ...
      DD_ENV                    = "production"
      DD_SERVICE                = "crucible-registry"
      DD_SITE                   = "datadoghq.com"
      DD_TRACE_ENABLED          = "true"
      DD_SERVERLESS_LOGS_ENABLED = "true"
      DD_CAPTURE_LAMBDA_PAYLOAD = "true"
    }
  }
}
```

### Monitors (Terraform)

Create at `volley-infra/terraform/crucible-registry/datadog/`:

| Monitor | Type | Threshold | Priority |
|---------|------|-----------|----------|
| High error rate | `aws.lambda.errors` by function | > 5% for 5min | P2 |
| High latency | `aws.lambda.duration.p95` | > 5000ms for 5min | P3 |
| Throttling | `aws.lambda.throttles` | > 0 for 5min | P2 |
| DynamoDB read latency | `aws.dynamodb.successful_request_latency` | > 100ms p95 | P3 |
| DynamoDB write errors | `aws.dynamodb.system_errors` on crucible-* | > 0 for 5min | P2 |
| API Gateway 5xx | `aws.apigateway.5xxerror` | > 1% for 5min | P1 |
| API Gateway 4xx (excl 404) | `aws.apigateway.4xxerror` | > 10% for 5min | P3 |
| Conditional write conflicts | Custom metric from Lambda | > 10/min | P4 (info) |

### Dashboard

**Crucible Registry API Dashboard:**
- Request rate by route (GET /games, PUT /games/:id, etc.)
- p50/p95/p99 latency by route
- Error rate by route and error code
- DynamoDB consumed capacity (read/write)
- Lambda cold start rate
- Concurrent executions

---

## 2. Game Server Pods (Production via Flux)

### Namespace Enablement

Add `crucible-dev` (and later staging/prod) to the Datadog agent's include list:

```yaml
# In kubernetes/infrastructure/shared-k8s-dev/datadog-agent/datadog-agent.yaml
DD_CONTAINER_INCLUDE: "kube_namespace:crucible-dev kube_namespace:crucible-staging kube_namespace:crucible-production"
```

### Pod Annotations

The Crucible HelmRelease config already includes Datadog env vars:

```yaml
env:
  DD_ENV: dev
  DD_SERVICE: crucible-server
  DD_LOGS_INJECTION: "true"
```

For APM, add `dd-trace` initialisation to the VGF server entry point. Since games are created from the hello-weekend template, this should be added to the template:

```typescript
// apps/server/src/dev.ts (or production entry point)
import tracer from "dd-trace"
tracer.init({
    service: "crucible-game-server",
    env: process.env.DD_ENV ?? "dev",
})
```

### Monitors

| Monitor | Type | Threshold | Priority |
|---------|------|-----------|----------|
| Pod crash loop | `kubernetes.containers.restarts` | > 3 in 10min | P1 |
| High memory usage | `kubernetes.memory.usage_pct` | > 90% for 5min | P2 |
| CPU throttling | `kubernetes.cpu.cfs_throttled_pct` | > 50% for 5min | P3 |
| Pod not ready | `kubernetes.pods.not_ready` | > 0 for 5min | P2 |
| Socket.IO connection errors | Custom metric | > 10% failure rate | P2 |
| Health check failures | `kubernetes.pod.healthcheck.failed` | > 0 for 2min | P1 |

### Dashboard

**Crucible Game Servers Dashboard:**
- Pod count by game and environment
- CPU/memory per game
- Request rate (Socket.IO connections)
- Error rate by game
- Phase transition latency (custom metric from VGF)
- Active sessions and players

---

## 3. Bifrost Prototypes

### Pod Annotations

Bifrost already adds `admission.datadoghq.com/enabled: "false"` to game pods to opt out of Datadog injection. For observability, we want basic metrics but not full APM (prototypes are throwaway).

**Recommended:** Keep APM disabled but collect:
- Container CPU/memory metrics (automatic from Datadog agent)
- Stdout/stderr logs (automatic with `containerCollectAll: true`)
- Build pod duration (custom metric from Bifrost controller)

### Monitors

| Monitor | Type | Threshold | Priority |
|---------|------|-----------|----------|
| Build pod failure rate | Custom metric from Bifrost | > 50% for 1h | P3 |
| Build pod duration | Custom metric | p95 > 10min | P4 |
| Prototype pod crash | `kubernetes.containers.restarts` in `*-prototype` ns | > 3 in 10min | P4 |
| Shared infra health | Postgres/MinIO/Redis pods | not ready for 2min | P2 |

---

## 4. CI Pipeline (GitHub Actions)

### Datadog CI Visibility

Use the Datadog GitHub Actions integration for pipeline observability:

```yaml
# In the crucible-deploy.yml workflow
- name: Configure Datadog CI
  uses: DataDog/datadog-ci-setup@v1
  with:
    api_key: ${{ secrets.DD_API_KEY }}
    site: datadoghq.com
```

### Monitors

| Monitor | Type | Threshold | Priority |
|---------|------|-----------|----------|
| Pipeline failure rate | CI Visibility | > 30% for 1h | P2 |
| Pipeline duration | CI Visibility | p95 > 10min | P3 |
| Deploy failure | Custom event | any failure | P1 |
| Rollback triggered | Custom event | any | P1 |

---

## 5. End-to-End Dashboard

**Crucible Operations Dashboard** — single pane of glass:

```
+-----------------------------------+-----------------------------------+
|  Games Overview                   |  Pipeline Health                  |
|  - Active prototypes: N           |  - Deploys today: N              |
|  - Published (dev): N             |  - Success rate: N%              |
|  - Published (prod): N            |  - Avg deploy time: Nm Ns        |
+-----------------------------------+-----------------------------------+
|  Registry API                     |  Game Servers                     |
|  - Request rate: N/s              |  - Active pods: N                |
|  - p95 latency: Nms              |  - Active sessions: N            |
|  - Error rate: N%                |  - Memory avg: N%                |
+-----------------------------------+-----------------------------------+
|  Bifrost Prototypes               |  Recent Events                    |
|  - Running: N                     |  - Deploy: game-x to dev (2m ago)|
|  - Building: N                    |  - Rollback: game-y (5m ago)     |
|  - Failed: N                      |  - Prototype: game-z (10m ago)   |
+-----------------------------------+-----------------------------------+
```

---

## Implementation Priority

| Phase | What | Effort | Blocked On |
|-------|------|--------|------------|
| **1** | Registry API Lambda layer + env vars | S | Registry API deployed (#2112) |
| **2** | Add crucible namespaces to Datadog agent include list | S | K8s admin access |
| **3** | Registry API Terraform monitors | M | Phase 1 |
| **4** | Game server APM (dd-trace in hello-weekend template) | M | Template change |
| **5** | Crucible Operations Dashboard | M | Phases 1-3 |
| **6** | CI Visibility integration | S | GitHub Actions workflow running |
| **7** | Bifrost prototype monitors | S | Bifrost metrics exposed |

**Start with Phase 1** — add Datadog Lambda layer to the Registry API Terraform (already have the PR open). Then Phase 2 (one-line K8s config change) and Phase 3 (monitors follow existing patterns).

---

## Slack Channel Routing

Following the existing Volley pattern:

| Channel | What |
|---------|------|
| `#crucible-alerts-dev` | Dev environment alerts (P3-P5) |
| `#crucible-alerts-prod` | Production alerts (P1-P2) |
| `#crucible-deploys` | Deploy events, rollbacks |
| `#crucible-builds` | Bifrost build status |

---

## Cost Estimate

Based on existing Volley Datadog usage:
- **Lambda instrumentation:** ~$5/month (5 functions, low volume)
- **APM traces (game servers):** ~$20/month per environment (depends on traffic)
- **Logs:** ~$10/month (structured JSON, 30-day retention)
- **Custom metrics:** ~$5/month (phase transitions, build durations)
- **Infrastructure metrics:** Included in existing Datadog agent (no additional cost)

**Total estimate:** ~$40-60/month for dev, scaling with game count and traffic.

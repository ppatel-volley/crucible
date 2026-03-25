# Docker Container Security Checklist

**Severity:** High
**Sources:** weekend-poker/019
**Category:** Docker, Security, DevOps

## Principle

Production Docker images must follow a mandatory security checklist: non-root user, readiness health check, production-only dependencies, BuildKit secrets for tokens, persistent volumes for stateful services, and pinned base image versions.

## Details

Six issues found in a production Docker configuration:

1. **Running as root** — no `USER` directive. Compromised app = root access inside container.
2. **Wrong health check** — used `/health` (liveness) instead of `/health/ready` (readiness). Container alive but not ready still receives traffic.
3. **devDependencies in production** — `pnpm install` without `--prod`. Bloated image, larger attack surface.
4. **npm token in Docker layer** — `.npmrc` with auth token copied during build. Anyone who pulls the image can extract it.
5. **No Redis volume** — data lost on container restart.
6. **Unpinned base images** — `FROM node:latest` causes non-reproducible builds.

### Mandatory Dockerfile checklist

```dockerfile
# 1. Pin base image version
FROM node:22-alpine AS builder

# 2. Use BuildKit secrets for npm tokens — NEVER copy .npmrc
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) pnpm install --frozen-lockfile

# 3. Production-only dependencies in final stage
FROM node:22-alpine AS runner
RUN pnpm install --prod --frozen-lockfile

# 4. Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# 5. Readiness health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/health/ready || exit 1
```

### docker-compose additions

```yaml
services:
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data  # 6. Persist Redis data
volumes:
  redis-data:
```

## Red Flags

- No `USER` directive in Dockerfile (defaults to root)
- `HEALTHCHECK` hitting `/health` instead of `/health/ready`
- `COPY .npmrc` or `ARG NPM_TOKEN` without BuildKit secrets
- `pnpm install` without `--prod` in the final stage
- `FROM node:latest` or any `:latest` tag
- Redis/database service without a volume mount
- `docker history <image>` showing secrets in layer commands

## Prevention

1. **CI lint step** — use `hadolint` to catch common Dockerfile mistakes.
2. **Multi-stage builds** — builder stage for compilation, runner stage with only production deps.
3. **Image scanning** — run `trivy` or `grype` in CI to catch vulnerabilities and leaked secrets.
4. **Template Dockerfile** — maintain a blessed template; new services copy from it.

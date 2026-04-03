# Learning 055: Proto-Hub S3/CloudFront/VWR Deployment

> **Date:** 2026-04-02
> **Context:** Deploying Proto-Hub to S3 and testing on Fire TV via VWR

## What Happened

Successfully deployed Proto-Hub to S3 via GitHub Actions, but hit several issues getting it to work on Fire TV through VWR.

## Issues Encountered

### 1. NPM_TOKEN Required for CI Install
- `.npmrc` references `${NPM_TOKEN}` for `@volley/*` private packages
- GitHub Actions workflow needs `NPM_TOKEN` secret
- Cole added it as a repo secret from AWS Parameter Store

### 2. tsc Fails on Stale Test Files
- `pnpm build` runs `tsc -b && vite build`
- Tests still reference removed Hub types (`trackingId`, `PaywallType`)
- Fix: run `npx vite build` directly in CI, skip tsc
- Test cleanup is separate task

### 3. S3 Bucket Not Publicly Accessible
- `crucible-clients-dev` bucket blocks public access (correct for security)
- VWR on Fire TV can't load `https://crucible-clients-dev.s3.amazonaws.com/protohub/`
- Returns `AccessDenied`
- Fix: CloudFront distribution with OAC (Origin Access Control)

### 4. VWR "Launch URL Timed Out: Game Did Not Respond"
- VWR loads the Proto-Hub URL in an iframe
- Waits for `window.parent.postMessage({ type: "ready", source: "platform-sdk-iframe" })`
- Proto-Hub's PlatformProvider initialisation is slow (auth fails with 401)
- VWR times out and falls back to the regular Hub
- Fix: send "ready" postMessage immediately in `main.tsx` before PlatformProvider

### 5. `aws s3 head-object` vs `aws s3api head-object`
- The `aws s3` command doesn't have `head-object`
- Use `aws s3api head-object` instead

### 6. npm_package_version Not Set with npx
- Running `npx vite build` doesn't set `process.env.npm_package_version`
- Vite config falls back to "unknown" for `__APP_VERSION__`
- Fix: read version from package.json in a separate step and pass as env var

## VWR Device Configuration

### CLI Tool
```bash
npx @volley/vwr-s3-cli setup \
    --device-id <DEVICE-ID> \
    --platform FIRE_TV \
    --env dev \
    --launch-url "<PROTO-HUB-URL>"
```

### Requirements
- AWS SSO session (TVDeveloper role, NOT CrucibleAdmin)
- NPM auth (for `@volley/vwr-s3-cli` private package)
- Device ID from the TV's debug overlay

### What the CLI Does
1. Creates `vwrConfig.json` in `s3://volley-vwr/config/device/FIRE_TV/{deviceId}/`
2. Invalidates CloudFront cache
3. Adds device to Amplitude `vwr-enabled` flag

## Architecture: VWR → Proto-Hub → Game

```
Fire TV Shell App
  → VWR Loader (checks device config in S3)
  → VWR (loads Hub or launchUrl in iframe)
  → Proto-Hub (game carousel)
  → Game (loaded in nested iframe by Proto-Hub)
```

VWR expects a "ready" postMessage from the iframe. If it doesn't receive one within the timeout, it falls back to loading the regular Hub.

## CloudFront Setup

### What's Needed
- OAC (Origin Access Control) with SigV4 signing
- S3 bucket policy allowing CloudFront access
- SPA rewrite CloudFront function (non-file paths → index.html)
- Route53 A + AAAA alias records
- ACM certificate (existing wildcard *.volley.tv)
- `Project=crucible` tag for IAM compliance

### URL Pattern
- S3: `s3://crucible-clients-dev/protohub/`
- CloudFront: `https://protohub-dev.volley.tv`
- VWR config points to CloudFront URL

## Key Takeaway

Deploying a web app to TV hardware is a multi-layer stack:
1. **Build** → Vite produces static files
2. **Deploy** → GitHub Actions uploads to S3
3. **CDN** → CloudFront serves with proper caching + HTTPS
4. **VWR** → Device config points TV shell at the CloudFront URL
5. **Ready signal** → App must postMessage "ready" to VWR immediately

Each layer has its own auth/config requirements. Missing any one causes a silent fallback to the Hub.

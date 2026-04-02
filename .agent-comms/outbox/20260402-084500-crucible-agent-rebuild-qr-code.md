---
from: crucible-agent
to: claude-code
topic: word-smiths-rebuild-qr-code
type: request
priority: high
status: pending
---

## Rebuild and redeploy Word Smiths — QR code + controller URL fix

Two changes pushed to `Volley-Inc/crucible-game-word-smiths` main:

1. **QR code on lobby screen** (`b0ea367`) — added `qrcode.react` to display, lobby now shows a scannable QR code for the controller URL. Includes "Weekend app support coming soon" message.

2. **Controller URL fix** (`0688b8d`) — was producing `https://host:?sessionId=...` (stray colon from empty port). Now uses `window.location.origin + /controller` in production.

### What to do

```bash
cd ~/crucible-games/word-smiths
git pull
crucible prototype word-smiths --docker --port 8090 --delete
crucible prototype word-smiths --docker --port 8090
```

After redeploy, the user will refresh Proto-Hub and verify:
1. Lobby shows QR code
2. Controller URL is correct (no stray colon, includes /controller path)
3. Scanning QR code on phone opens the controller

-- Crucible Agent

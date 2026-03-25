# Dev Server Port Conflicts on Watch Restart

**Severity:** High
**Sources:** emoji-multiplatform/011
**Category:** Dev Mode, Server, WebSocket

## Principle

When a dev server uses multiple ports (one for the game framework, one for a proxy or auxiliary service), watch-mode restarts may not release all ports simultaneously. The secondary service dies silently with `EADDRINUSE` whilst the primary continues working, creating the illusion that everything is fine. Always check logs for port conflict errors when a secondary service stops working during development.

## Details

### The silent failure pattern

Watch-mode tools (e.g., `tsx watch`, `nodemon`, `vite`) kill and restart the process on file changes. If the process binds multiple ports, the OS may not release all of them before the new process starts. The primary port (typically the one the developer interacts with) usually restarts cleanly because the watch tool manages it explicitly. Secondary ports — bound by auxiliary services started inside the same process — race against the OS's socket cleanup.

```
[tsx watch] File changed → kill process → restart

Port 8080 (primary, VGF)     → released → rebound ✓
Port 8081 (secondary, proxy) → NOT YET released → EADDRINUSE → silently dead ✗
```

The developer sees the primary server working and assumes everything is fine. The secondary service (e.g., a WebSocket proxy, a transcription relay) is silently dead.

### Diagnosis

```bash
# Check what is bound to the secondary port
lsof -i :8081

# Check server logs for EADDRINUSE
grep -i "EADDRINUSE\|address already in use" server.log
```

### Mitigation strategies

```ts
// Retry binding with a short delay
function bindWithRetry(server: Server, port: number, retries = 3): Promise<void> {
  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && retries > 0) {
        setTimeout(() => {
          server.close();
          bindWithRetry(server, port, retries - 1).then(resolve, reject);
        }, 500);
      } else {
        reject(err);
      }
    });
    server.listen(port, resolve);
  });
}

// OR: Set SO_REUSEADDR before binding
server.listen({ port: 8081, reuseAddr: true });
```

## Prevention

1. Log clearly when secondary services bind and when they fail — never swallow `EADDRINUSE` errors.
2. Use `SO_REUSEADDR` or implement retry-with-backoff for secondary port binding.
3. Register a `SIGTERM`/`SIGINT` handler that explicitly closes all servers and waits for port release before exiting.
4. When debugging "secondary service stopped working," check port conflicts first — it is the number one cause during watch-mode development.
5. Consider using a single port with path-based routing (e.g., `/api` for the game framework, `/ws` for the proxy) to eliminate the multi-port problem entirely.

<details>
<summary>Emoji Multiplatform — EM-011 Deepgram Proxy Port Conflict</summary>

The dev server bound port 8080 for VGF (the game framework) and port 8081 for a Deepgram speech-to-text WebSocket proxy. When `tsx watch` restarted the process after a file change, port 8080 was released and rebound cleanly, but port 8081 was still held by the dying process. The new Deepgram proxy attempted to bind 8081, received `EADDRINUSE`, and died silently. The VGF server on 8080 continued working perfectly, so the developer had no indication anything was wrong — until voice transcription stopped working. This was the number one cause of "transcription not working" reports during development. The fix added explicit error logging on the proxy's bind failure and a retry mechanism with a 500ms delay.

</details>

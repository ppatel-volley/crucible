# Redis Client Consolidation in Server Processes

**Severity:** High
**Sources:** weekend-poker/018
**Category:** Infrastructure, Redis, Production

## Principle

Create ONE shared Redis client per server process with a single retry/resilience configuration. Pass it to all consumers via dependency injection. Close it in a single shutdown path. Multiple Redis clients with different retry strategies create inconsistent failure modes, connection leaks, and wasted resources.

## Details

A server process had three separate Redis clients, each with different retry strategies:

1. **Resilient client** — queues commands indefinitely when Redis is down
2. **Persistence singleton** — throws after 20 retries
3. **Scheduler client** — no explicit retry logic

When Redis went down, one client silently queued, another threw errors, and the third hung. The scheduler client was never closed during graceful shutdown, leaking connections.

### The correct pattern

```ts
// Create once at startup
const redisClient = createResilientRedisClient(config);

// Pass to all consumers via dependency injection
const persistence = new PersistenceService(redisClient);
const scheduler = new GameScheduler(redisClient);
const storage = new RedisSessionStorage(redisClient);

// Single shutdown path — close everything
process.on('SIGTERM', async () => {
  await redisClient.quit();
});
```

## Red Flags

- Multiple `createClient()` or `new Redis()` calls in the same server process
- Different retry configurations across Redis consumers
- Shutdown handlers that only close some Redis connections
- Health checks that test one Redis client while others are silently disconnected
- "Redis works for X but not for Y" bugs in production

## Prevention

1. **Single client factory** — create Redis clients in exactly one place, export a shared instance.
2. **Dependency injection** — pass the client to consumers rather than letting them create their own.
3. **Shutdown audit** — `SIGTERM` handler must close every external connection; grep for `createClient` to find any that aren't wired in.
4. **Connection count monitoring** — alert if a single server process holds more Redis connections than expected.

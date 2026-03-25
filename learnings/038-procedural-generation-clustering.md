# Procedural Generation Clustering Prevention

**Severity:** Medium
**Sources:** finalfrontier/011
**Category:** Procedural Generation, Game Design

## Principle

When generating multiple instances of the same type procedurally, track what has already been placed to prevent clustering. Probability distributions must match the intended rarity of each outcome — a "rare" result appearing 33% of the time is not rare. Handle candidate exhaustion gracefully by returning `null` rather than forcing a placement into an unsuitable location.

## Details

### The clustering problem

Procedural generation that treats each placement as independent will naturally produce clusters. If each placement has a flat probability and no spatial awareness, the generator has no mechanism to spread results across the available space.

```ts
// WRONG — independent rolls, no tracking, clustering inevitable
function placeStations(parents: Body[]): Station[] {
  const stations: Station[] = [];
  for (const body of parents) {
    if (Math.random() < 0.33) {
      stations.push(createStation(body));
    }
  }
  return stations; // two stations can spawn on adjacent bodies
}

// CORRECT — track placements, exclude neighbours, match rarity
function placeStations(parents: Body[]): Station[] {
  const count = weightedRandom({ 0: 0.50, 1: 0.45, 2: 0.05 });
  const stations: Station[] = [];
  const usedParents = new Set<string>();

  for (let i = 0; i < count; i++) {
    const candidates = parents.filter(
      (p) => !usedParents.has(p.id) && !hasNearbyStation(p, usedParents)
    );
    if (candidates.length === 0) break; // graceful exhaustion
    const chosen = pickRandom(candidates);
    usedParents.add(chosen.id);
    stations.push(createStation(chosen));
  }
  return stations;
}
```

### Pattern for clustering prevention

1. **Track placed items** — maintain a set of occupied positions or parent entities.
2. **Exclude conflicts** — filter candidates to remove positions too close to existing placements.
3. **Handle exhaustion** — if no suitable candidates remain, return `null` or stop placing. Never force a placement.
4. **Match probability to rarity** — if something should be rare, ensure the distribution reflects that (e.g., 5% chance, not 33%).

## Prevention

1. Always define the target distribution explicitly (e.g., `{ 0: 0.50, 1: 0.45, 2: 0.05 }`) rather than using a flat per-item probability.
2. Write tests that run the generator N times and assert the output distribution falls within expected bounds.
3. Visualise placements during development — clustering is immediately obvious when you can see it.
4. Review candidate filtering logic for off-by-one errors in spatial exclusion zones.

<details>
<summary>Final Frontier — FF-011 Station Clustering</summary>

Two space stations spawned on adjacent parent bodies in the same solar system, breaking the intended feeling of isolation and scarcity. The root cause was a 33% per-body probability with no spatial tracking — statistically, having two stations was far too common (roughly 1 in 3 systems). The fix introduced a weighted distribution (50% zero stations, 45% one, 5% two), tracked used parent bodies in a set, excluded them from future candidates, and returned early if no suitable candidates remained. After the fix, two-station systems became genuinely rare, matching the game's intended design.

</details>

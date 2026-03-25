import { readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { CruciblePaths, CrucibleConfig } from "../types.js"
import { ensureDir } from "./paths.js"
import { validateConfig, DEFAULT_CONFIG } from "./schema.js"

export async function loadConfig(paths: CruciblePaths): Promise<CrucibleConfig> {
    try {
        const raw = await readFile(paths.configFile, "utf-8")
        return validateConfig(JSON.parse(raw))
    } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
            return { ...DEFAULT_CONFIG }
        }
        throw err
    }
}

export async function saveConfig(paths: CruciblePaths, config: CrucibleConfig): Promise<void> {
    await ensureDir(dirname(paths.configFile))
    await writeFile(paths.configFile, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

export async function updateConfig(
    paths: CruciblePaths,
    partial: Partial<CrucibleConfig>,
): Promise<CrucibleConfig> {
    const current = await loadConfig(paths)
    const merged = { ...current, ...partial }
    await saveConfig(paths, merged)
    return merged
}

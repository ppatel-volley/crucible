import { join } from "node:path"
import { homedir } from "node:os"
import { mkdir } from "node:fs/promises"
import type { CruciblePaths } from "../types.js"

const ensuredDirs = new Set<string>()

export async function ensureDir(dir: string): Promise<void> {
    if (ensuredDirs.has(dir)) return
    await mkdir(dir, { recursive: true })
    ensuredDirs.add(dir)
}

/** Reset the ensured dirs cache (for testing). */
export function _resetEnsuredDirs(): void {
    ensuredDirs.clear()
}

function resolveConfigDir(): string {
    if (process.platform === "win32") {
        return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "crucible")
    }
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "crucible")
}

function resolveDataDir(): string {
    if (process.platform === "win32") {
        return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "crucible")
    }
    return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "crucible")
}

export function resolvePaths(overrides?: Partial<CruciblePaths>): CruciblePaths {
    const configDir = overrides?.configDir ?? resolveConfigDir()
    const dataDir = overrides?.dataDir ?? resolveDataDir()

    return {
        configDir,
        configFile: overrides?.configFile ?? join(configDir, "config.json"),
        dataDir,
        gamesDir: overrides?.gamesDir ?? join(homedir(), "crucible-games"),
        sessionsDir: overrides?.sessionsDir ?? join(dataDir, "sessions"),
    }
}

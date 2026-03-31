import { readdir, readFile, writeFile, rm, cp, stat, rename } from "node:fs/promises"
import { join, extname, relative, dirname, basename } from "node:path"
import type { CrucibleConfig, TemplateEngineOptions, TemplateEngineResult } from "../types.js"

const TEXT_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".yaml",
    ".yml",
    ".md",
    ".html",
    ".sh",
    ".css",
    ".svg",
    ".env",
    ".gitignore",
    ".eslintrc",
    ".prettierrc",
])

/** Files without extensions (or dot-prefixed) that should be treated as text */
const EXTENSIONLESS_TEXT_FILES = new Set([
    "Dockerfile",
    "Makefile",
    "LICENSE",
    "Procfile",
    ".env",
    ".gitignore",
    ".eslintrc",
    ".prettierrc",
    ".editorconfig",
    ".nvmrc",
    ".npmrc",
])

const TEMPLATE_ARTIFACTS_DIRS = [
    "learnings",
    "skills",
    "reviews",
    ".claude",
    ".cursor",
    ".agent-comms",
]

const TEMPLATE_ARTIFACTS_FILES = [
    "AGENTS.md",
    "AGENTS-PROJECT.md",
    "AGENTS-REACT-TS.md",
    "AGENTS-THREEJS.md",
    "AGENTS-RLM.md",
    "AGENTS-INFRA.md",
    "CLAUDE.md",
    "BUILDING_TV_GAMES.md",
    "README.md",
]

/**
 * Clone / copy a template to the target path.
 */
export async function cloneTemplate(
    source: CrucibleConfig["templateSource"],
    targetPath: string,
): Promise<void> {
    if (source.type === "local") {
        await cp(source.path, targetPath, {
            recursive: true,
            filter: (src) => {
                const rel = relative(source.path, src)
                const segments = rel.split(/[\\/]/)
                // Exclude .git, node_modules, and dist at ANY depth
                return !segments.includes(".git") && !segments.includes("node_modules") && !segments.includes("dist")
            },
        })
    } else {
        const simpleGit = (await import("simple-git")).default
        const git = simpleGit()
        // Normalise owner/repo shorthand to full HTTPS URL
        const repoUrl = source.repo.includes("://") || source.repo.includes("@")
            ? source.repo
            : `https://github.com/${source.repo}.git`
        await git.clone(repoUrl, targetPath, ["--depth", "1", "--branch", source.ref])
        await rm(join(targetPath, ".git"), { recursive: true, force: true })
    }
}

/**
 * Walk a directory tree and return all file paths.
 */
async function walkDir(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...(await walkDir(fullPath)))
        } else {
            files.push(fullPath)
        }
    }
    return files
}

/**
 * Build ordered replacement pairs from a token map.
 * Longer tokens are replaced first to avoid partial matches.
 */
function buildReplacementPairs(
    tokenMap: TemplateEngineOptions["tokenMap"],
): Array<{ from: string; to: string }> {
    const pairs: Array<{ from: string; to: string }> = [
        tokenMap.packageScope,
        tokenMap.loggerName,
        tokenMap.displayName,
        tokenMap.gameNamePascal,
        tokenMap.gameNameKebab,
    ]
    // Sort longest-first
    pairs.sort((a, b) => b.from.length - a.from.length)
    return pairs
}

/**
 * Replace all token occurrences in file contents and rename files/directories.
 */
export async function replaceTokens(
    options: TemplateEngineOptions,
): Promise<TemplateEngineResult> {
    const { targetPath, tokenMap } = options
    const pairs = buildReplacementPairs(tokenMap)

    let filesProcessed = 0
    let tokensReplaced = 0

    // Phase 1: Replace file contents
    const allFiles = await walkDir(targetPath)
    for (const filePath of allFiles) {
        const ext = extname(filePath).toLowerCase()
        const name = basename(filePath)
        if (!TEXT_EXTENSIONS.has(ext) && !EXTENSIONLESS_TEXT_FILES.has(name)) continue

        const content = await readFile(filePath, "utf-8")
        let newContent = content
        for (const pair of pairs) {
            const count = newContent.split(pair.from).length - 1
            if (count > 0) {
                tokensReplaced += count
                newContent = newContent.split(pair.from).join(pair.to)
            }
        }
        if (newContent !== content) {
            await writeFile(filePath, newContent, "utf-8")
            filesProcessed++
        }
    }

    // Phase 2: Rename files and directories containing template references
    // Process deepest paths first so renames don't invalidate parent paths
    const allPaths = await walkDir(targetPath)
    const dirs = new Set<string>()
    for (const p of allPaths) {
        let d = dirname(p)
        while (d !== targetPath && d.length > targetPath.length) {
            dirs.add(d)
            d = dirname(d)
        }
    }

    const sortedPaths = [...allPaths, ...dirs].sort((a, b) => b.length - a.length)
    for (const fullPath of sortedPaths) {
        const name = basename(fullPath)
        let newName = name
        for (const pair of pairs) {
            newName = newName.split(pair.from).join(pair.to)
        }
        if (newName !== name) {
            const newPath = join(dirname(fullPath), newName)
            try {
                await rename(fullPath, newPath)
            } catch {
                // Path may already have been moved by a parent rename
            }
        }
    }

    return { filesProcessed, tokensReplaced, filesRemoved: [] }
}

/**
 * Remove template-only artefacts from the target directory.
 */
export async function removeTemplateArtifacts(targetPath: string): Promise<string[]> {
    const removed: string[] = []

    for (const dir of TEMPLATE_ARTIFACTS_DIRS) {
        const fullPath = join(targetPath, dir)
        try {
            const s = await stat(fullPath)
            if (s.isDirectory()) {
                await rm(fullPath, { recursive: true, force: true })
                removed.push(dir)
            }
        } catch {
            // Does not exist — skip
        }
    }

    for (const file of TEMPLATE_ARTIFACTS_FILES) {
        const fullPath = join(targetPath, file)
        try {
            const s = await stat(fullPath)
            if (s.isFile()) {
                await rm(fullPath)
                removed.push(file)
            }
        } catch {
            // Does not exist — skip
        }
    }

    return removed
}

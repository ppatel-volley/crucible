import { exec, execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface KubectlResult {
    stdout: string
    stderr: string
}

/**
 * Apply a YAML manifest via kubectl apply --server-side.
 * Uses spawn to pipe manifest content via stdin.
 */
export async function kubectlApply(
    manifest: string,
    namespace: string
): Promise<KubectlResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "kubectl",
            [
                "apply",
                "--server-side",
                "--force-conflicts",
                "--namespace",
                namespace,
                "-f",
                "-",
            ],
            { timeout: 30_000 }
        )

        let stdout = ""
        let stderr = ""

        child.stdout.on("data", (data: Buffer) => {
            stdout += data.toString()
        })
        child.stderr.on("data", (data: Buffer) => {
            stderr += data.toString()
        })
        child.on("close", (code) => {
            if (code === 0) {
                resolve({ stdout, stderr })
            } else {
                reject(new Error(`kubectl apply exited with code ${code}: ${stderr}`))
            }
        })
        child.on("error", reject)

        child.stdin.write(manifest)
        child.stdin.end()
    })
}

/**
 * Wait for a deployment rollout to complete.
 */
export async function kubectlRolloutWait(
    deploymentName: string,
    namespace: string,
    timeoutSeconds: number
): Promise<KubectlResult> {
    const { stdout, stderr } = await execFileAsync(
        "kubectl",
        [
            "rollout",
            "status",
            `deployment/${deploymentName}`,
            "--namespace",
            namespace,
            `--timeout=${timeoutSeconds}s`,
        ],
        { timeout: (timeoutSeconds + 10) * 1000 }
    )
    return { stdout, stderr }
}

/**
 * Get the current image tag from a deployment.
 */
export async function kubectlGetImage(
    deploymentName: string,
    namespace: string
): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(
            "kubectl",
            [
                "get",
                `deployment/${deploymentName}`,
                "--namespace",
                namespace,
                "-o",
                "jsonpath={.spec.template.spec.containers[0].image}",
            ],
            { timeout: 10_000 }
        )
        return stdout.trim() || null
    } catch {
        return null
    }
}

/**
 * Set the image on a deployment (for rollback).
 */
export async function kubectlSetImage(
    deploymentName: string,
    namespace: string,
    image: string
): Promise<KubectlResult> {
    const { stdout, stderr } = await execFileAsync(
        "kubectl",
        [
            "set",
            "image",
            `deployment/${deploymentName}`,
            `game=${image}`,
            "--namespace",
            namespace,
        ],
        { timeout: 15_000 }
    )
    return { stdout, stderr }
}

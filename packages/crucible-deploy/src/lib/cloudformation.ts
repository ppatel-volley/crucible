import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * Ensure the IRSA CloudFormation stack exists for a game.
 * Creates it if missing, no-ops if it already exists.
 */
export async function ensureIrsaStack(
    stackName: string,
    templateBody: string
): Promise<"created" | "exists" | "updated"> {
    const exists = await stackExists(stackName)

    if (exists) {
        try {
            await execFileAsync(
                "aws",
                [
                    "cloudformation",
                    "update-stack",
                    "--stack-name",
                    stackName,
                    "--template-body",
                    templateBody,
                    "--capabilities",
                    "CAPABILITY_NAMED_IAM",
                ],
                { timeout: 60_000 }
            )
            await waitForStack(stackName, "update")
            return "updated"
        } catch (err) {
            if (
                err instanceof Error &&
                err.message.includes("No updates are to be performed")
            ) {
                return "exists"
            }
            throw err
        }
    }

    await execFileAsync(
        "aws",
        [
            "cloudformation",
            "create-stack",
            "--stack-name",
            stackName,
            "--template-body",
            templateBody,
            "--capabilities",
            "CAPABILITY_NAMED_IAM",
        ],
        { timeout: 60_000 }
    )
    await waitForStack(stackName, "create")
    return "created"
}

async function stackExists(stackName: string): Promise<boolean> {
    try {
        await execFileAsync(
            "aws",
            [
                "cloudformation",
                "describe-stacks",
                "--stack-name",
                stackName,
            ],
            { timeout: 15_000 }
        )
        return true
    } catch {
        return false
    }
}

async function waitForStack(
    stackName: string,
    operation: "create" | "update"
): Promise<void> {
    const waiter =
        operation === "create"
            ? "stack-create-complete"
            : "stack-update-complete"
    await execFileAsync(
        "aws",
        ["cloudformation", "wait", waiter, "--stack-name", stackName],
        { timeout: 300_000 }
    )
}

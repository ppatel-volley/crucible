import { createServer, type Server } from "node:http"
import { URL } from "node:url"

export interface CallbackResult {
    code: string
    state: string
}

/**
 * Start an ephemeral HTTP server on 127.0.0.1:0 (OS-assigned port).
 * Waits for an OAuth callback with ?code= and ?state= params.
 * Returns the code and state, then shuts down.
 */
export function startCallbackServer(options: {
    timeoutMs?: number // default: 300000 (5 min)
    expectedState: string
}): Promise<{ port: number; waitForCallback: () => Promise<CallbackResult>; close: () => void }> {
    return new Promise((resolve, reject) => {
        const server: Server = createServer()
        let callbackResolve: (result: CallbackResult) => void
        let callbackReject: (err: Error) => void

        const callbackPromise = new Promise<CallbackResult>((res, rej) => {
            callbackResolve = res
            callbackReject = rej
        })

        const timeout = setTimeout(() => {
            server.close()
            callbackReject(new Error("Login timed out after 5 minutes"))
        }, options.timeoutMs ?? 300_000)

        server.on("request", (req, res) => {
            const url = new URL(req.url!, `http://127.0.0.1`)
            const code = url.searchParams.get("code")
            const state = url.searchParams.get("state")
            const error = url.searchParams.get("error")

            if (error) {
                res.writeHead(400, { "Content-Type": "text/html" })
                res.end(
                    "<html><body><h1>Login failed</h1><p>You can close this tab.</p></body></html>",
                )
                clearTimeout(timeout)
                callbackReject(new Error(`OAuth error: ${error}`))
                return
            }

            if (!code || !state) {
                res.writeHead(400, { "Content-Type": "text/html" })
                res.end("<html><body><h1>Invalid callback</h1></body></html>")
                return
            }

            if (state !== options.expectedState) {
                res.writeHead(400, { "Content-Type": "text/html" })
                res.end("<html><body><h1>State mismatch</h1></body></html>")
                clearTimeout(timeout)
                callbackReject(new Error("OAuth state mismatch — possible CSRF attack"))
                return
            }

            res.writeHead(200, { "Content-Type": "text/html" })
            res.end(
                "<html><body><h1>Login successful!</h1><p>You can close this tab and return to the terminal.</p></body></html>",
            )
            clearTimeout(timeout)
            callbackResolve({ code, state })
        })

        server.listen(0, "127.0.0.1", () => {
            const addr = server.address()
            if (!addr || typeof addr === "string") {
                reject(new Error("Failed to start callback server"))
                return
            }
            resolve({
                port: addr.port,
                waitForCallback: () => callbackPromise,
                close: () => {
                    clearTimeout(timeout)
                    server.close()
                },
            })
        })
    })
}

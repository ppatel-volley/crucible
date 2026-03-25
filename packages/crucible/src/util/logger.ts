import chalk, { type ChalkInstance } from "chalk"
import ora, { type Ora } from "ora"
import type { GlobalOptions, Logger, LogLevel, SpinnerHandle } from "../types.js"

function isUTF8(): boolean {
    if (process.env["CRUCIBLE_ASCII"] === "1") return false
    const lang = process.env["LC_ALL"] ?? process.env["LANG"] ?? ""
    return /utf-?8/i.test(lang)
}

function symbols(ascii: boolean): { tick: string; cross: string } {
    return ascii ? { tick: "[OK]", cross: "[FAIL]" } : { tick: "✓", cross: "✗" }
}

function shouldDisableColor(options: GlobalOptions): boolean {
    if (!options.color) return true
    if (process.env["NO_COLOR"] === "1") return true
    if (process.env["TERM"] === "dumb") return true
    if (!process.stdout.isTTY) return true
    return false
}

export function createLogger(options: GlobalOptions): Logger {
    const disableColor = shouldDisableColor(options)
    if (disableColor) {
        chalk.level = 0
    }

    const ascii = !isUTF8()
    const sym = symbols(ascii)

    function jsonLine(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        const entry: Record<string, unknown> = {
            level,
            message,
            timestamp: new Date().toISOString(),
        }
        if (data !== undefined) {
            entry.data = data
        }
        process.stdout.write(JSON.stringify(entry) + "\n")
    }

    function formatData(data?: Record<string, unknown>): string {
        if (!data || Object.keys(data).length === 0) return ""
        return " " + JSON.stringify(data)
    }

    const logger: Logger = {
        debug(message: string, data?: Record<string, unknown>): void {
            if (!options.verbose) return
            if (options.json) {
                jsonLine("debug", message, data)
                return
            }
            process.stderr.write(chalk.gray(`[debug] ${message}${formatData(data)}`) + "\n")
        },

        info(message: string, data?: Record<string, unknown>): void {
            if (options.quiet) return
            if (options.json) {
                jsonLine("info", message, data)
                return
            }
            process.stdout.write(chalk.cyan(message) + formatData(data) + "\n")
        },

        warn(message: string, data?: Record<string, unknown>): void {
            if (options.json) {
                jsonLine("warn", message, data)
                return
            }
            process.stderr.write(chalk.yellow(`⚠ ${message}${formatData(data)}`) + "\n")
        },

        error(message: string, data?: Record<string, unknown>): void {
            if (options.json) {
                jsonLine("error", message, data)
                return
            }
            process.stderr.write(chalk.red(`${sym.cross} ${message}${formatData(data)}`) + "\n")
        },

        spinner(message: string): SpinnerHandle {
            const spinner: Ora = ora({
                text: message,
                isSilent: options.quiet || options.json,
                color: "cyan",
            }).start()

            return {
                succeed(text?: string): void {
                    spinner.succeed(text)
                },
                fail(text?: string): void {
                    spinner.fail(text)
                },
                update(text: string): void {
                    spinner.text = text
                },
                stop(): void {
                    spinner.stop()
                },
            }
        },

        success(message: string): void {
            if (options.quiet) return
            if (options.json) {
                jsonLine("info", message)
                return
            }
            process.stdout.write(chalk.green(`${sym.tick} ${message}`) + "\n")
        },

        fail(message: string): void {
            if (options.json) {
                jsonLine("error", message)
                return
            }
            process.stderr.write(chalk.red(`${sym.cross} ${message}`) + "\n")
        },
    }

    return logger
}

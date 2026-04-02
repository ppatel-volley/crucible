import { describe, it, expect, vi, beforeEach } from "vitest"
import {
    buildImageRef,
    buildGameImage,
    tagImage,
    pushImage,
    pushToPrototypeRegistry,
    isDockerAvailable,
} from "../../prototype/registry.js"
import { CrucibleError } from "../../util/errors.js"

vi.mock("execa", () => ({
    execa: vi.fn(),
}))

describe("registry", () => {
    let mockExeca: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        vi.clearAllMocks()
        const execaMod = await import("execa")
        mockExeca = execaMod.execa as unknown as ReturnType<typeof vi.fn>
        mockExeca.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 })
    })

    describe("buildImageRef", () => {
        it("uses default registry when not specified", () => {
            const ref = buildImageRef("my-game", "abc1234")
            expect(ref).toBe("bifrost-registry.volley-services.net/my-game:abc1234")
        })

        it("uses custom registry when provided", () => {
            const ref = buildImageRef("my-game", "abc1234", "custom.registry.io:8080")
            expect(ref).toBe("custom.registry.io:8080/my-game:abc1234")
        })
    })

    describe("tagImage", () => {
        it("calls docker tag with correct args", async () => {
            await tagImage("local-image:dev", "bifrost-registry.volley-services.net/my-game:v1")

            expect(mockExeca).toHaveBeenCalledWith("docker", [
                "tag",
                "local-image:dev",
                "bifrost-registry.volley-services.net/my-game:v1",
            ])
        })
    })

    describe("pushImage", () => {
        it("calls docker push with correct args", async () => {
            await pushImage("bifrost-registry.volley-services.net/my-game:v1")

            expect(mockExeca).toHaveBeenCalledWith("docker", [
                "push",
                "bifrost-registry.volley-services.net/my-game:v1",
            ])
        })

        it("throws networkError when push fails", async () => {
            mockExeca.mockRejectedValueOnce(new Error("connection refused"))

            await expect(
                pushImage("bifrost-registry.volley-services.net/my-game:v1"),
            ).rejects.toThrow(CrucibleError)
        })
    })

    describe("pushToPrototypeRegistry", () => {
        it("full flow: tags then pushes, returns image ref", async () => {
            const ref = await pushToPrototypeRegistry({
                gameId: "my-game",
                localImage: "local-image:dev",
                tag: "abc1234",
            })

            expect(ref).toBe("bifrost-registry.volley-services.net/my-game:abc1234")
            expect(mockExeca).toHaveBeenCalledTimes(2)
            expect(mockExeca).toHaveBeenNthCalledWith(1, "docker", [
                "tag",
                "local-image:dev",
                "bifrost-registry.volley-services.net/my-game:abc1234",
            ])
            expect(mockExeca).toHaveBeenNthCalledWith(2, "docker", [
                "push",
                "bifrost-registry.volley-services.net/my-game:abc1234",
            ])
        })

        it("uses 'latest' tag when not specified", async () => {
            const ref = await pushToPrototypeRegistry({
                gameId: "my-game",
                localImage: "local-image:dev",
            })

            expect(ref).toBe("bifrost-registry.volley-services.net/my-game:latest")
        })
    })

    describe("buildGameImage", () => {
        it("builds with correct docker build args", async () => {
            const localImage = await buildGameImage({
                gamePath: "/tmp/my-game",
                gameId: "my-game",
                tag: "abc1234",
            })

            expect(localImage).toBe("my-game:abc1234")
            expect(mockExeca).toHaveBeenCalledWith(
                "docker",
                ["build", "-t", "my-game:abc1234", "/tmp/my-game"],
                { timeout: 300_000 },
            )
        })

        it("defaults to 'latest' tag when not specified", async () => {
            const localImage = await buildGameImage({
                gamePath: "/tmp/my-game",
                gameId: "my-game",
            })

            expect(localImage).toBe("my-game:latest")
        })

        it("throws CRUCIBLE-902 on build failure", async () => {
            mockExeca.mockRejectedValueOnce(new Error("Dockerfile syntax error"))

            await expect(
                buildGameImage({ gamePath: "/tmp/bad", gameId: "bad-game" }),
            ).rejects.toThrow(CrucibleError)

            try {
                mockExeca.mockRejectedValueOnce(new Error("Dockerfile syntax error"))
                await buildGameImage({ gamePath: "/tmp/bad", gameId: "bad-game" })
            } catch (err) {
                expect((err as CrucibleError).code).toBe("CRUCIBLE-902")
            }
        })
    })

    describe("isDockerAvailable", () => {
        it("returns true when docker succeeds", async () => {
            mockExeca.mockResolvedValueOnce({ stdout: "24.0.7", stderr: "", exitCode: 0 })

            const result = await isDockerAvailable()

            expect(result).toBe(true)
            expect(mockExeca).toHaveBeenCalledWith("docker", [
                "version",
                "--format",
                "{{.Server.Version}}",
            ])
        })

        it("returns false when docker fails", async () => {
            mockExeca.mockRejectedValueOnce(new Error("command not found"))

            const result = await isDockerAvailable()

            expect(result).toBe(false)
        })
    })
})

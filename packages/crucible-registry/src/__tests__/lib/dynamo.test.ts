import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("@aws-sdk/lib-dynamodb", () => ({
    DynamoDBDocumentClient: {
        from: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
    },
    GetCommand: vi.fn(),
    PutCommand: vi.fn(),
    QueryCommand: vi.fn(),
}))

describe("dynamo table configuration", () => {
    const originalEnv = process.env

    beforeEach(() => {
        process.env = { ...originalEnv }
        vi.resetModules()
    })

    afterEach(() => {
        process.env = originalEnv
    })

    it("CATALOG_TABLE defaults to 'crucible-catalog'", async () => {
        delete process.env.CATALOG_TABLE
        const { CATALOG_TABLE } = await import("../../lib/dynamo.js")
        expect(CATALOG_TABLE).toBe("crucible-catalog")
    })

    it("VERSIONS_TABLE defaults to 'crucible-versions'", async () => {
        delete process.env.VERSIONS_TABLE
        const { VERSIONS_TABLE } = await import("../../lib/dynamo.js")
        expect(VERSIONS_TABLE).toBe("crucible-versions")
    })

    it("uses env vars when set", async () => {
        process.env.CATALOG_TABLE = "my-custom-catalog"
        process.env.VERSIONS_TABLE = "my-custom-versions"
        const { CATALOG_TABLE, VERSIONS_TABLE } = await import(
            "../../lib/dynamo.js"
        )
        expect(CATALOG_TABLE).toBe("my-custom-catalog")
        expect(VERSIONS_TABLE).toBe("my-custom-versions")
    })
})

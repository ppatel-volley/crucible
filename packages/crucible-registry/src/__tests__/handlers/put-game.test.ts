import { describe, it, expect, vi, beforeEach } from "vitest"
import type { APIGatewayProxyEvent } from "aws-lambda"

const mockSend = vi.fn()

vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}))

vi.mock("@aws-sdk/lib-dynamodb", () => ({
    DynamoDBDocumentClient: {
        from: vi.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: vi.fn().mockImplementation((input) => input),
}))

const { handler } = await import("../../handlers/put-game.js")

function makeEvent(
    overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
    return {
        httpMethod: "PUT",
        path: "/games/test-game",
        pathParameters: { gameId: "test-game" },
        queryStringParameters: null,
        headers: {},
        body: JSON.stringify({ displayName: "Test Game", description: "A test" }),
        isBase64Encoded: false,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as APIGatewayProxyEvent["requestContext"],
        resource: "",
        ...overrides,
    }
}

describe("PUT /games/:gameId", () => {
    beforeEach(() => {
        mockSend.mockReset()
    })

    it("returns 200 on successful registration", async () => {
        mockSend.mockResolvedValueOnce({})

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(200)
        const body = JSON.parse(result.body)
        expect(body.gameId).toBe("test-game")
        expect(body.status).toBe("registered")
    })

    it("returns 400 on missing gameId", async () => {
        const result = await handler(
            makeEvent({ pathParameters: null }),
        )

        expect(result.statusCode).toBe(400)
        const body = JSON.parse(result.body)
        expect(body.error).toBe("Missing gameId")
    })

    it("returns 400 on invalid JSON body", async () => {
        const result = await handler(
            makeEvent({ body: "not-valid-json{{{" }),
        )

        expect(result.statusCode).toBe(400)
        const body = JSON.parse(result.body)
        expect(body.error).toBe("Invalid JSON body")
    })

    it("returns 409 on conditional check failure (concurrent write)", async () => {
        const error = new Error("ConditionalCheckFailedException")
        error.name = "ConditionalCheckFailedException"
        mockSend.mockRejectedValueOnce(error)

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(409)
        const body = JSON.parse(result.body)
        expect(body.error).toContain("Conflict")
    })

    it("returns 500 on unexpected DynamoDB error", async () => {
        mockSend.mockRejectedValueOnce(new Error("Something went wrong"))

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(500)
        const body = JSON.parse(result.body)
        expect(body.error).toBe("Internal server error")
    })
})

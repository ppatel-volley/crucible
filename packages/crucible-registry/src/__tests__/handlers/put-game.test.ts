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
        requestContext: {
            authorizer: { principalId: "ci-user" },
        } as unknown as APIGatewayProxyEvent["requestContext"],
        resource: "",
        ...overrides,
    }
}

describe("PUT /games/:gameId", () => {
    beforeEach(() => {
        mockSend.mockReset()
    })

    it("returns 401 when not authenticated", async () => {
        const result = await handler(
            makeEvent({
                requestContext: {} as APIGatewayProxyEvent["requestContext"],
            }),
        )
        expect(result.statusCode).toBe(401)
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

    it("uses create condition and sets createdAt on first registration", async () => {
        mockSend.mockResolvedValueOnce({})

        await handler(makeEvent())

        const putInput = mockSend.mock.calls[0][0] as {
            ConditionExpression: string
            Item: Record<string, unknown>
        }
        expect(putInput.ConditionExpression).toBe(
            "attribute_not_exists(gameId)",
        )
        expect(putInput.Item.createdAt).toBeDefined()
        expect(typeof putInput.Item.createdAt).toBe("string")
    })

    it("uses update condition when expectedUpdatedAt is present and omits createdAt", async () => {
        mockSend.mockResolvedValueOnce({})
        const prior = "2025-01-01T12:00:00.000Z"

        await handler(
            makeEvent({
                body: JSON.stringify({
                    displayName: "Updated",
                    expectedUpdatedAt: prior,
                }),
            }),
        )

        const putInput = mockSend.mock.calls[0][0] as {
            ConditionExpression: string
            ExpressionAttributeValues?: Record<string, string>
            Item: Record<string, unknown>
        }
        expect(putInput.ConditionExpression).toBe(
            "attribute_exists(gameId) AND updatedAt = :expected",
        )
        expect(putInput.ExpressionAttributeValues).toEqual({
            ":expected": prior,
        })
        expect(putInput.Item).not.toHaveProperty("createdAt")
        expect(putInput.Item.displayName).toBe("Updated")
    })

    it("persists path gameId and drops unknown body keys", async () => {
        mockSend.mockResolvedValueOnce({})

        await handler(
            makeEvent({
                body: JSON.stringify({
                    displayName: "OK",
                    gameId: "other-game",
                    evilKey: "nope",
                }),
            }),
        )

        const putInput = mockSend.mock.calls[0][0] as {
            Item: Record<string, unknown>
        }
        expect(putInput.Item.gameId).toBe("test-game")
        expect(putInput.Item.displayName).toBe("OK")
        expect(putInput.Item).not.toHaveProperty("evilKey")
    })

    it("does not persist expectedUpdatedAt on the catalog item", async () => {
        mockSend.mockResolvedValueOnce({})

        await handler(
            makeEvent({
                body: JSON.stringify({
                    displayName: "X",
                    expectedUpdatedAt: "2025-01-01T00:00:00.000Z",
                }),
            }),
        )

        const putInput = mockSend.mock.calls[0][0] as {
            Item: Record<string, unknown>
        }
        expect(putInput.Item).not.toHaveProperty("expectedUpdatedAt")
    })

    it("returns 500 on unexpected DynamoDB error", async () => {
        mockSend.mockRejectedValueOnce(new Error("Something went wrong"))

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(500)
        const body = JSON.parse(result.body)
        expect(body.error).toBe("Internal server error")
    })
})

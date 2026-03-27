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
    ScanCommand: vi.fn().mockImplementation((input) => input),
}))

// Import after mocks are set up
const { handler } = await import("../../handlers/get-games.js")

function makeEvent(
    overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
    return {
        httpMethod: "GET",
        path: "/games",
        pathParameters: null,
        queryStringParameters: null,
        headers: {},
        body: null,
        isBase64Encoded: false,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as APIGatewayProxyEvent["requestContext"],
        resource: "",
        ...overrides,
    }
}

describe("GET /games", () => {
    beforeEach(() => {
        mockSend.mockReset()
    })

    it("returns 200 with list of games", async () => {
        const games = [
            { gameId: "pong", displayName: "Pong" },
            { gameId: "breakout", displayName: "Breakout" },
        ]
        mockSend.mockResolvedValueOnce({ Items: games })

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(200)
        const body = JSON.parse(result.body)
        expect(body.games).toEqual(games)
        expect(body.games).toHaveLength(2)
    })

    it("filters out disabled games via FilterExpression", async () => {
        // The handler sends a FilterExpression to DynamoDB, so we just verify
        // the command was constructed properly and returns whatever Dynamo returns
        mockSend.mockResolvedValueOnce({ Items: [{ gameId: "active-game" }] })

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(200)
        const body = JSON.parse(result.body)
        expect(body.games).toEqual([{ gameId: "active-game" }])

        // Verify the ScanCommand was called with correct filter
        const scanInput = mockSend.mock.calls[0][0]
        expect(scanInput.FilterExpression).toContain("disabled")
    })

    it("returns 200 with empty list when no games", async () => {
        mockSend.mockResolvedValueOnce({ Items: [] })

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(200)
        const body = JSON.parse(result.body)
        expect(body.games).toEqual([])
    })

    it("returns 500 on DynamoDB error", async () => {
        mockSend.mockRejectedValueOnce(new Error("DynamoDB exploded"))

        const result = await handler(makeEvent())

        expect(result.statusCode).toBe(500)
        const body = JSON.parse(result.body)
        expect(body.error).toBe("Internal server error")
    })
})

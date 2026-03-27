import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb"
import { verifyAuth } from "../lib/auth.js"

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)
const CATALOG_TABLE = process.env.CATALOG_TABLE ?? "crucible-catalog"

export async function handler(
    event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
    // Auth check — PUT requires authenticated CI caller
    const auth = verifyAuth(event)
    if (!auth.authenticated) {
        return {
            statusCode: 401,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Authentication required" }),
        }
    }

    const gameId = event.pathParameters?.gameId
    if (!gameId) {
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Missing gameId" }),
        }
    }

    let body: Record<string, unknown>
    try {
        body = JSON.parse(event.body ?? "{}")
    } catch {
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Invalid JSON body" }),
        }
    }

    // Client must provide expectedUpdatedAt for optimistic concurrency.
    // First write (new game) uses attribute_not_exists; subsequent writes
    // must match the previous updatedAt exactly to detect conflicts.
    const expectedUpdatedAt = body.expectedUpdatedAt as string | undefined
    const now = new Date().toISOString()

    try {
        const conditionExpression = expectedUpdatedAt
            ? "attribute_exists(gameId) AND updatedAt = :expected"
            : "attribute_not_exists(gameId)"
        const expressionValues = expectedUpdatedAt
            ? { ":expected": expectedUpdatedAt }
            : undefined

        await docClient.send(
            new PutCommand({
                TableName: CATALOG_TABLE,
                Item: {
                    gameId,
                    ...body,
                    updatedAt: now,
                    registeredBy: auth.principal,
                },
                ConditionExpression: conditionExpression,
                ...(expressionValues && {
                    ExpressionAttributeValues: expressionValues,
                }),
            }),
        )

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameId, status: "registered" }),
        }
    } catch (err: unknown) {
        if (
            err instanceof Error &&
            err.name === "ConditionalCheckFailedException"
        ) {
            return {
                statusCode: 409,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    error: "Conflict — game was updated concurrently. Retry.",
                }),
            }
        }
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Internal server error" }),
        }
    }
}

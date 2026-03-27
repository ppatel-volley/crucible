import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb"

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)
const CATALOG_TABLE = process.env.CATALOG_TABLE ?? "crucible-catalog"

export async function handler(
    event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
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

    const now = new Date().toISOString()

    try {
        // Conditional write — fail if game already exists with a different version
        // to prevent race conditions during concurrent deploys
        await docClient.send(
            new PutCommand({
                TableName: CATALOG_TABLE,
                Item: {
                    gameId,
                    ...body,
                    updatedAt: now,
                },
                ConditionExpression:
                    "attribute_not_exists(gameId) OR updatedAt <= :ts",
                ExpressionAttributeValues: { ":ts": now },
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

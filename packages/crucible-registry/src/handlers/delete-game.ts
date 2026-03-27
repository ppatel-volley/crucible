import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb"

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

    try {
        await docClient.send(
            new UpdateCommand({
                TableName: CATALOG_TABLE,
                Key: { gameId },
                UpdateExpression: "SET disabled = :t, updatedAt = :now",
                ExpressionAttributeValues: {
                    ":t": true,
                    ":now": new Date().toISOString(),
                },
                ConditionExpression: "attribute_exists(gameId)",
            }),
        )

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameId, status: "disabled" }),
        }
    } catch (err: unknown) {
        if (
            err instanceof Error &&
            err.name === "ConditionalCheckFailedException"
        ) {
            return {
                statusCode: 404,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Game not found" }),
            }
        }
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Internal server error" }),
        }
    }
}

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { verifyAuth } from "../lib/auth.js"

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)
const VERSIONS_TABLE = process.env.VERSIONS_TABLE ?? "crucible-versions"

export async function handler(
    event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
    // Auth check — history requires authenticated user
    const auth = verifyAuth(event)
    if (!auth.authenticated) {
        return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Authentication required" }) }
    }

    const gameId = event.pathParameters?.gameId
    if (!gameId) {
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Missing gameId" }),
        }
    }

    try {
        const result = await docClient.send(
            new QueryCommand({
                TableName: VERSIONS_TABLE,
                KeyConditionExpression: "gameId = :gid",
                ExpressionAttributeValues: { ":gid": gameId },
                ScanIndexForward: false,
            }),
        )

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ versions: result.Items ?? [] }),
        }
    } catch {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Internal server error" }),
        }
    }
}

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb"

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)
const CATALOG_TABLE = process.env.CATALOG_TABLE ?? "crucible-catalog"

export async function handler(
    event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
    try {
        const result = await docClient.send(
            new ScanCommand({
                TableName: CATALOG_TABLE,
                FilterExpression:
                    "attribute_not_exists(disabled) OR disabled = :f",
                ExpressionAttributeValues: { ":f": false },
            }),
        )

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ games: result.Items ?? [] }),
        }
    } catch {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Internal server error" }),
        }
    }
}

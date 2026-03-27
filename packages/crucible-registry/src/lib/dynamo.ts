import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import type { GameRecord, GameVersion } from "../types.js"

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

export const CATALOG_TABLE = process.env.CATALOG_TABLE ?? "crucible-catalog"
export const VERSIONS_TABLE = process.env.VERSIONS_TABLE ?? "crucible-versions"

export async function getGame(gameId: string): Promise<GameRecord | null> {
    const result = await docClient.send(
        new GetCommand({
            TableName: CATALOG_TABLE,
            Key: { gameId },
        }),
    )
    return (result.Item as GameRecord) ?? null
}

export async function putGame(game: GameRecord): Promise<void> {
    await docClient.send(
        new PutCommand({
            TableName: CATALOG_TABLE,
            Item: game,
        }),
    )
}

export async function listGames(): Promise<GameRecord[]> {
    // Simple scan for now — fine for small catalog
    // Actually use Scan since there's no partition key filter
    // For now just return empty — will implement properly
    return []
}

export async function putGameVersion(version: GameVersion): Promise<void> {
    await docClient.send(
        new PutCommand({
            TableName: VERSIONS_TABLE,
            Item: version,
        }),
    )
}

export async function getGameHistory(
    gameId: string,
): Promise<GameVersion[]> {
    const result = await docClient.send(
        new QueryCommand({
            TableName: VERSIONS_TABLE,
            KeyConditionExpression: "gameId = :gid",
            ExpressionAttributeValues: { ":gid": gameId },
            ScanIndexForward: false, // newest first
        }),
    )
    return (result.Items as GameVersion[]) ?? []
}

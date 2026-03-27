import type { APIGatewayProxyEvent } from "aws-lambda"

/**
 * Verify IAM/SSO auth from API Gateway authoriser context.
 * Stub implementation — will be wired to Cognito / IAM when infra is ready.
 */
export function verifyAuth(
    event: APIGatewayProxyEvent,
): { authenticated: boolean; principal?: string } {
    const authContext = event.requestContext.authorizer
    if (!authContext) {
        return { authenticated: false }
    }

    return {
        authenticated: true,
        principal: (authContext.principalId as string) ?? "unknown",
    }
}

/**
 * Check whether the caller has admin privileges.
 */
export function isAdmin(event: APIGatewayProxyEvent): boolean {
    const authContext = event.requestContext.authorizer
    if (!authContext) return false
    return authContext.isAdmin === "true" || authContext.role === "admin"
}

import type { ManifestContext } from "../types.js"

/**
 * Render all K8s manifests for a game deployment.
 * Returns a single multi-document YAML string.
 */
export function renderManifests(ctx: ManifestContext): string {
    const docs = [
        renderServiceAccount(ctx),
        renderDeployment(ctx),
        renderService(ctx),
        renderIngress(ctx),
        renderScaledObject(ctx),
        renderNetworkPolicy(ctx),
    ]
    return docs.join("\n---\n")
}

function renderServiceAccount(ctx: ManifestContext): string {
    return `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${ctx.gameId}
  namespace: ${ctx.namespace}
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::${ctx.accountId}:role/crucible-game-${ctx.gameId}-${ctx.env}
  labels:
    app: ${ctx.gameId}
    crucible.volley.tv/managed-by: crucible-deploy`
}

function renderDeployment(ctx: ManifestContext): string {
    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${ctx.gameId}
  namespace: ${ctx.namespace}
  labels:
    app: ${ctx.gameId}
    crucible.volley.tv/managed-by: crucible-deploy
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${ctx.gameId}
  template:
    metadata:
      labels:
        app: ${ctx.gameId}
        crucible.volley.tv/managed-by: crucible-deploy
    spec:
      serviceAccountName: ${ctx.gameId}
      terminationGracePeriodSeconds: 35
      containers:
        - name: game
          image: ${ctx.image}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          env:
            - name: GAME_ID
              value: "${ctx.gameId}"
            - name: STAGE
              value: "${ctx.env}"
            - name: PORT
              value: "8080"
            - name: DD_ENV
              value: "${ctx.env}"
            - name: DD_SERVICE
              value: "crucible-${ctx.gameId}"
            - name: DD_AGENT_HOST
              valueFrom:
                fieldRef:
                  fieldPath: status.hostIP
          readinessProbe:
            httpGet:
              path: /${ctx.gameId}/health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /${ctx.gameId}/health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          securityContext:
            runAsNonRoot: true
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "30"]`
}

function renderService(ctx: ManifestContext): string {
    return `apiVersion: v1
kind: Service
metadata:
  name: ${ctx.gameId}
  namespace: ${ctx.namespace}
  labels:
    app: ${ctx.gameId}
    crucible.volley.tv/managed-by: crucible-deploy
spec:
  type: ClusterIP
  selector:
    app: ${ctx.gameId}
  ports:
    - name: http
      port: 80
      targetPort: 8080
      protocol: TCP`
}

function renderIngress(ctx: ManifestContext): string {
    const host = `crucible-games-${ctx.env}.volley-services.net`
    return `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${ctx.gameId}
  namespace: ${ctx.namespace}
  annotations:
    alb.ingress.kubernetes.io/group.name: crucible-${ctx.env}
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-policy: ELBSecurityPolicy-TLS13-1-2-2021-06
    alb.ingress.kubernetes.io/healthcheck-path: /${ctx.gameId}/health/ready
    alb.ingress.kubernetes.io/target-group-attributes: stickiness.enabled=true,stickiness.lb_cookie.duration_seconds=86400
    alb.ingress.kubernetes.io/load-balancer-attributes: idle_timeout.timeout_seconds=3600
  labels:
    app: ${ctx.gameId}
    crucible.volley.tv/managed-by: crucible-deploy
spec:
  ingressClassName: alb
  rules:
    - host: ${host}
      http:
        paths:
          - path: /${ctx.gameId}
            pathType: Prefix
            backend:
              service:
                name: ${ctx.gameId}
                port:
                  number: 80`
}

function renderScaledObject(ctx: ManifestContext): string {
    return `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: ${ctx.gameId}
  namespace: ${ctx.namespace}
  labels:
    app: ${ctx.gameId}
    crucible.volley.tv/managed-by: crucible-deploy
spec:
  scaleTargetRef:
    name: ${ctx.gameId}
  minReplicaCount: 0
  maxReplicaCount: 5
  cooldownPeriod: 300
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus-server.monitoring.svc.cluster.local
        metricName: crucible_pending_activations
        query: crucible_pending_activations{game_id="${ctx.gameId}"}
        threshold: "1"
    - type: prometheus
      metadata:
        serverAddress: http://prometheus-server.monitoring.svc.cluster.local
        metricName: crucible_active_sessions
        query: sum(crucible_active_sessions{game_id="${ctx.gameId}"})
        threshold: "20"`
}

function renderNetworkPolicy(ctx: ManifestContext): string {
    return `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${ctx.gameId}
  namespace: ${ctx.namespace}
  labels:
    app: ${ctx.gameId}
    crucible.volley.tv/managed-by: crucible-deploy
spec:
  podSelector:
    matchLabels:
      app: ${ctx.gameId}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - ports:
        - port: 8080
          protocol: TCP
  egress:
    - ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
    - to:
        - namespaceSelector:
            matchLabels:
              name: ${ctx.namespace}
      ports:
        - port: 6379
          protocol: TCP
    - ports:
        - port: 443
          protocol: TCP`
}

/**
 * Render IRSA CloudFormation template for a game.
 */
export function renderIrsaTemplate(ctx: ManifestContext): string {
    const oidcProvider =
        ctx.oidcProvider ??
        process.env.EKS_OIDC_PROVIDER ??
        (() => {
            throw new Error(
                "OIDC provider not set. Pass --oidc-provider or set EKS_OIDC_PROVIDER env var."
            )
        })()
    return `AWSTemplateFormatVersion: "2010-09-09"
Description: IRSA role for Crucible game ${ctx.gameId} (${ctx.env})

Resources:
  GameRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: crucible-game-${ctx.gameId}-${ctx.env}
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Federated: arn:aws:iam::${ctx.accountId}:oidc-provider/${oidcProvider}
            Action: sts:AssumeRoleWithWebIdentity
            Condition:
              StringEquals:
                "${oidcProvider}:sub": "system:serviceaccount:${ctx.namespace}:${ctx.gameId}"
      Policies:
        - PolicyName: s3-client-access
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - s3:GetObject
                  - s3:PutObject
                  - s3:ListBucket
                Resource:
                  - arn:aws:s3:::crucible-clients-${ctx.env}/${ctx.gameId}/*
                  - arn:aws:s3:::crucible-clients-${ctx.env}
        - PolicyName: ecr-pull
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - ecr:GetAuthorizationToken
                Resource: "*"
              - Effect: Allow
                Action:
                  - ecr:GetDownloadUrlForLayer
                  - ecr:BatchGetImage
                Resource: arn:aws:ecr:us-east-1:${ctx.accountId}:repository/crucible-games
      Tags:
        - Key: Project
          Value: crucible
        - Key: GameId
          Value: ${ctx.gameId}
        - Key: Environment
          Value: ${ctx.env}
        - Key: ManagedBy
          Value: crucible-deploy

Outputs:
  RoleArn:
    Value: !GetAtt GameRole.Arn`
}

CREATE TABLE "AiGatewayRoute" (
    "id" TEXT NOT NULL,
    "scene" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeoutMs" INTEGER NOT NULL DEFAULT 120000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGatewayRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGatewayRouteTarget" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGatewayRouteTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGatewayRequest" (
    "id" TEXT NOT NULL,
    "scene" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "provider" VARCHAR(60),
    "model" VARCHAR(120),
    "latencyMs" INTEGER NOT NULL,
    "attemptCount" INTEGER NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(100),
    "errorMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGatewayRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGatewayAttempt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "connectionId" TEXT,
    "sequence" INTEGER NOT NULL,
    "targetKey" VARCHAR(240) NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "errorCode" VARCHAR(100),
    "errorMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGatewayAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiGatewayRoute_scene_key" ON "AiGatewayRoute"("scene");
CREATE UNIQUE INDEX "AiGatewayRouteTarget_routeId_connectionId_key" ON "AiGatewayRouteTarget"("routeId", "connectionId");
CREATE INDEX "AiGatewayRouteTarget_routeId_enabled_priority_idx" ON "AiGatewayRouteTarget"("routeId", "enabled", "priority");
CREATE INDEX "AiGatewayRouteTarget_connectionId_idx" ON "AiGatewayRouteTarget"("connectionId");
CREATE INDEX "AiGatewayRequest_createdAt_idx" ON "AiGatewayRequest"("createdAt");
CREATE INDEX "AiGatewayRequest_scene_createdAt_idx" ON "AiGatewayRequest"("scene", "createdAt");
CREATE INDEX "AiGatewayRequest_status_createdAt_idx" ON "AiGatewayRequest"("status", "createdAt");
CREATE INDEX "AiGatewayRequest_provider_createdAt_idx" ON "AiGatewayRequest"("provider", "createdAt");
CREATE UNIQUE INDEX "AiGatewayAttempt_requestId_sequence_key" ON "AiGatewayAttempt"("requestId", "sequence");
CREATE INDEX "AiGatewayAttempt_connectionId_createdAt_idx" ON "AiGatewayAttempt"("connectionId", "createdAt");
CREATE INDEX "AiGatewayAttempt_status_createdAt_idx" ON "AiGatewayAttempt"("status", "createdAt");

ALTER TABLE "AiGatewayRouteTarget"
ADD CONSTRAINT "AiGatewayRouteTarget_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "AiGatewayRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiGatewayRouteTarget"
ADD CONSTRAINT "AiGatewayRouteTarget_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiGatewayAttempt"
ADD CONSTRAINT "AiGatewayAttempt_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "AiGatewayRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiGatewayAttempt"
ADD CONSTRAINT "AiGatewayAttempt_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "IntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

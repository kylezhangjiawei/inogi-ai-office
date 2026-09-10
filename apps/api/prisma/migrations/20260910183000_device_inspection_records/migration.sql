-- New domain only; no existing data is changed.
-- CreateTable
CREATE TABLE "DeviceInspectionRecord" (
    "id" TEXT NOT NULL,
    "clientId" VARCHAR(128) NOT NULL,
    "testId" VARCHAR(160) NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "snapshotSchema" VARCHAR(64) NOT NULL,
    "recordAppVersion" VARCHAR(64),
    "uploaderAppVersion" VARCHAR(64) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "resultProjection" JSONB NOT NULL,
    "collectionAt" TIMESTAMP(3) NOT NULL,
    "saveAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uid" VARCHAR(24),
    "uidVerified" BOOLEAN NOT NULL DEFAULT false,
    "serialNumber" VARCHAR(256) NOT NULL DEFAULT '',
    "model" VARCHAR(256) NOT NULL DEFAULT '',
    "market" VARCHAR(256) NOT NULL DEFAULT '',
    "station" VARCHAR(256) NOT NULL DEFAULT '',
    "operator" VARCHAR(256) NOT NULL DEFAULT '',
    "firmwareVersion" VARCHAR(512),
    "ruleVersion" VARCHAR(256),
    "protocolVersion" VARCHAR(256),
    "inspectionResult" VARCHAR(16) NOT NULL,
    "productionPass" BOOLEAN NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "abnormalCount" INTEGER NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "abnormalItems" JSONB NOT NULL,
    "itemIds" TEXT[],
    "readStatuses" TEXT[],
    "itemStatusKeys" TEXT[],
    "abnormalItemIds" TEXT[],
    "abnormalReadStatuses" TEXT[],

    CONSTRAINT "DeviceInspectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_collectionAt_id_idx" ON "DeviceInspectionRecord"("collectionAt", "id");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_uid_uidVerified_collectionAt_id_idx" ON "DeviceInspectionRecord"("uid", "uidVerified", "collectionAt", "id");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_inspectionResult_collectionAt_id_idx" ON "DeviceInspectionRecord"("inspectionResult", "collectionAt", "id");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_receivedAt_id_idx" ON "DeviceInspectionRecord"("receivedAt", "id");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_itemIds_idx" ON "DeviceInspectionRecord" USING GIN ("itemIds");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_readStatuses_idx" ON "DeviceInspectionRecord" USING GIN ("readStatuses");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_itemStatusKeys_idx" ON "DeviceInspectionRecord" USING GIN ("itemStatusKeys");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_abnormalItemIds_idx" ON "DeviceInspectionRecord" USING GIN ("abnormalItemIds");

-- CreateIndex
CREATE INDEX "DeviceInspectionRecord_abnormalReadStatuses_idx" ON "DeviceInspectionRecord" USING GIN ("abnormalReadStatuses");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInspectionRecord_clientId_testId_key" ON "DeviceInspectionRecord"("clientId", "testId");

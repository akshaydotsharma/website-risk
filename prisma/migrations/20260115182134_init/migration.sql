-- CreateTable
CREATE TABLE "WebsiteScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,
    "checkedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScanDataPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sources" TEXT NOT NULL,
    "rawOpenAIResponse" TEXT NOT NULL,
    "extractedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanDataPoint_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "WebsiteScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WebsiteScan_url_idx" ON "WebsiteScan"("url");

-- CreateIndex
CREATE INDEX "WebsiteScan_domain_idx" ON "WebsiteScan"("domain");

-- CreateIndex
CREATE INDEX "ScanDataPoint_scanId_idx" ON "ScanDataPoint"("scanId");

-- CreateIndex
CREATE INDEX "ScanDataPoint_key_idx" ON "ScanDataPoint"("key");

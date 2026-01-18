-- CreateTable
CREATE TABLE "AuthorizedDomain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "allowSubdomains" BOOLEAN NOT NULL DEFAULT true,
    "respectRobots" BOOLEAN NOT NULL DEFAULT true,
    "maxPagesPerScan" INTEGER NOT NULL DEFAULT 50,
    "crawlDelayMs" INTEGER NOT NULL DEFAULT 1000,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CrawlFetchLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "statusCode" INTEGER,
    "contentType" TEXT,
    "contentLength" INTEGER,
    "fetchDurationMs" INTEGER,
    "errorMessage" TEXT,
    "robotsAllowed" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrawlFetchLog_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "WebsiteScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizedDomain_domain_key" ON "AuthorizedDomain"("domain");

-- CreateIndex
CREATE INDEX "AuthorizedDomain_domain_idx" ON "AuthorizedDomain"("domain");

-- CreateIndex
CREATE INDEX "CrawlFetchLog_scanId_idx" ON "CrawlFetchLog"("scanId");

-- CreateIndex
CREATE INDEX "CrawlFetchLog_url_idx" ON "CrawlFetchLog"("url");

-- CreateIndex
CREATE INDEX "CrawlFetchLog_createdAt_idx" ON "CrawlFetchLog"("createdAt");

-- CreateTable
CREATE TABLE "IssueReasonAnalysis" (
    "id" TEXT NOT NULL,
    "productionUpdateId" TEXT NOT NULL,
    "translation" TEXT,
    "englishSummary" TEXT,
    "suggestedCategory" TEXT,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "providerModel" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "finalCategory" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueReasonAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueReasonAnalysis_productionUpdateId_key" ON "IssueReasonAnalysis"("productionUpdateId");

-- CreateIndex
CREATE INDEX "IssueReasonAnalysis_reviewStatus_idx" ON "IssueReasonAnalysis"("reviewStatus");

-- CreateIndex
CREATE INDEX "IssueReasonAnalysis_processingStatus_idx" ON "IssueReasonAnalysis"("processingStatus");

-- AddForeignKey
ALTER TABLE "IssueReasonAnalysis" ADD CONSTRAINT "IssueReasonAnalysis_productionUpdateId_fkey" FOREIGN KEY ("productionUpdateId") REFERENCES "ProductionUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

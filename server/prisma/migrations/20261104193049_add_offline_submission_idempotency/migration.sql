/*
  Warnings:

  - A unique constraint covering the columns `[clientRequestId]` on the table `ProductionUpdate` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ProductionUpdate" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProductionUpdate_clientRequestId_key" ON "ProductionUpdate"("clientRequestId");

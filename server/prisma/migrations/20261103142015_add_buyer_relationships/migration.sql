/*
  Warnings:

  - You are about to drop the column `buyerName` on the `Order` table. All the data in the column will be lost.
  - Added the required column `buyerId` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "buyerName",
ADD COLUMN     "buyerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "buyerId" TEXT;

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_orderId_idx" ON "AuditLog"("orderId");

-- CreateIndex
CREATE INDEX "Milestone_orderId_idx" ON "Milestone"("orderId");

-- CreateIndex
CREATE INDEX "Order_buyerId_idx" ON "Order"("buyerId");

-- CreateIndex
CREATE INDEX "Order_exFactoryDate_idx" ON "Order"("exFactoryDate");

-- CreateIndex
CREATE INDEX "ProductionUpdate_orderId_idx" ON "ProductionUpdate"("orderId");

-- CreateIndex
CREATE INDEX "ProductionUpdate_userId_idx" ON "ProductionUpdate"("userId");

-- CreateIndex
CREATE INDEX "User_buyerId_idx" ON "User"("buyerId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

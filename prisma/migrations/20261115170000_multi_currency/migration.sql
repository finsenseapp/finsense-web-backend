-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'LKR';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "accountAmount" DECIMAL(14,2),
ADD COLUMN     "rate" DECIMAL(18,8),
ADD COLUMN     "toAmount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "DayRates" (
    "date" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayRates_pkey" PRIMARY KEY ("date")
);

CREATE TABLE "payment_wallets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_wallets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_wallets_userId_key" ON "payment_wallets"("userId");
CREATE UNIQUE INDEX "payment_wallets_address_key" ON "payment_wallets"("address");
ALTER TABLE "payment_wallets" ADD CONSTRAINT "payment_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

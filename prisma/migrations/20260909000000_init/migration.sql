CREATE TABLE "transactions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "transaction_date" DATETIME NOT NULL,
  "vendor_name" TEXT,
  "product_name" TEXT,
  "amount" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "note" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

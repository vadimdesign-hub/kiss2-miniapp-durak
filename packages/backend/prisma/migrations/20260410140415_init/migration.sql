-- CreateTable
CREATE TABLE "lucky_coin_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lucky_coin_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lucky_coin_attempts_user_id_idx" ON "lucky_coin_attempts"("user_id");

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" UUID NOT NULL,
    "game_type" TEXT NOT NULL,
    "player_one_id" UUID NOT NULL,
    "player_two_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_results" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "game_type" TEXT NOT NULL,
    "winner_id" UUID,
    "loser_id" UUID,
    "is_draw" BOOLEAN NOT NULL DEFAULT false,
    "duration_seconds" INTEGER NOT NULL,
    "coins_awarded" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_sessions_player_one_id_idx" ON "game_sessions"("player_one_id");

-- CreateIndex
CREATE INDEX "game_sessions_player_two_id_idx" ON "game_sessions"("player_two_id");

-- CreateIndex
CREATE INDEX "game_sessions_status_idx" ON "game_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "game_results_session_id_key" ON "game_results"("session_id");

-- CreateIndex
CREATE INDEX "game_results_winner_id_idx" ON "game_results"("winner_id");

-- CreateIndex
CREATE INDEX "game_results_loser_id_idx" ON "game_results"("loser_id");

-- CreateIndex
CREATE INDEX "game_results_created_at_idx" ON "game_results"("created_at");

-- AddForeignKey
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

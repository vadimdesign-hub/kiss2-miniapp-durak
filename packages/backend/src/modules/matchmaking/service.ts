import type { RedisClient } from "@playneta/node-kiss2-lib/plugins";
import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";

const SERVICE_PREFIX = "kiss2-miniapp-durak";
const SESSION_TTL_SEC = 7200; // 2 hours

export interface MatchmakingSession {
	sessionId: string;
	gameType: string;
	playerOneId: string;
	playerTwoId: string;
	starterUserId: string;
	state: Record<string, unknown>;
}

export class MatchmakingService {
	constructor(
		private readonly redis: RedisClient,
		private readonly prisma: PrismaClient,
		private readonly logger: FastifyBaseLogger,
	) {}

	private queueKey(gameType: string) {
		return `${SERVICE_PREFIX}:queue:${gameType}`;
	}

	private sessionKey(sessionId: string) {
		return `${SERVICE_PREFIX}:session:${sessionId}`;
	}

	/**
	 * Pop the head of the queue if it's NOT the calling user. Returns the popped
	 * userId or null. The caller is responsible for verifying the popped user is
	 * still alive (socket open) and either matching or discarding.
	 */
	async popWaitingOpponent(callingUserId: string, gameType: string): Promise<string | null> {
		const key = this.queueKey(gameType);
		const head = await this.redis.lPop(key);
		if (!head) return null;
		if (head === callingUserId) {
			// Same user popped (stale entry from a reconnect). Drop it and try again.
			return this.popWaitingOpponent(callingUserId, gameType);
		}
		return head;
	}

	/**
	 * Add user to the back of the queue if not already present. Idempotent.
	 */
	async enqueue(userId: string, gameType: string): Promise<void> {
		const key = this.queueKey(gameType);
		const existing = await this.redis.lPos(key, userId);
		if (existing !== null) return;
		await this.redis.rPush(key, userId);
		this.logger.info({ userId, gameType }, "User enqueued");
	}

	async leaveQueue(userId: string, gameType: string): Promise<void> {
		await this.redis.lRem(this.queueKey(gameType), 0, userId);
		this.logger.info({ userId, gameType }, "User left queue");
	}

	/** Number of players currently waiting for `gameType`. */
	async queueSize(gameType: string): Promise<number> {
		return this.redis.lLen(this.queueKey(gameType));
	}

	async getSession(sessionId: string): Promise<MatchmakingSession | null> {
		const raw = await this.redis.get(this.sessionKey(sessionId));
		if (!raw) return null;
		return JSON.parse(raw) as MatchmakingSession;
	}

	async updateSessionState(sessionId: string, state: Record<string, unknown>): Promise<void> {
		const session = await this.getSession(sessionId);
		if (!session) return;
		session.state = state;
		await this.redis.setEx(this.sessionKey(sessionId), SESSION_TTL_SEC, JSON.stringify(session));
	}

	async finalizeSession(
		sessionId: string,
		winnerId: string | null,
		isDraw: boolean,
		durationSeconds: number,
		coinsAwarded: number,
	): Promise<void> {
		const session = await this.getSession(sessionId);
		if (!session) return;

		const loserId = isDraw
			? null
			: winnerId === session.playerOneId
				? session.playerTwoId
				: session.playerOneId;

		await this.prisma.gameSession.update({
			where: { id: sessionId },
			data: { status: "finished" },
		});

		await this.prisma.gameResult.create({
			data: {
				sessionId,
				gameType: session.gameType,
				winnerId,
				loserId,
				isDraw,
				durationSeconds,
				coinsAwarded,
			},
		});

		await this.redis.del(this.sessionKey(sessionId));
		this.logger.info({ sessionId, winnerId, isDraw }, "Session finalized");
	}

	async createSession(
		playerOneId: string,
		playerTwoId: string,
		gameType: string,
	): Promise<MatchmakingSession> {
		const dbSession = await this.prisma.gameSession.create({
			data: { gameType, playerOneId, playerTwoId },
		});

		const starterUserId = Math.random() < 0.5 ? playerOneId : playerTwoId;

		const session: MatchmakingSession = {
			sessionId: dbSession.id,
			gameType,
			playerOneId,
			playerTwoId,
			starterUserId,
			state: {},
		};

		await this.redis.setEx(
			this.sessionKey(dbSession.id),
			SESSION_TTL_SEC,
			JSON.stringify(session),
		);

		this.logger.info(
			{ sessionId: dbSession.id, playerOneId, playerTwoId, gameType },
			"Match created",
		);
		return session;
	}

	/**
	 * Clear the entire queue for a gameType. Used on server startup to drop any
	 * stale userIds from a previous deploy that won't respond to MATCH_FOUND.
	 */
	async clearQueue(gameType: string): Promise<number> {
		const key = this.queueKey(gameType);
		const count = await this.redis.lLen(key);
		await this.redis.del(key);
		if (count > 0) {
			this.logger.info({ gameType, removed: count }, "Cleared stale queue on startup");
		}
		return count;
	}
}

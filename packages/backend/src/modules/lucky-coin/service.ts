import type { KafkaProducerService } from "@playneta/node-kiss2-lib/services";
import type { AnalyticsHeaders } from "@playneta/node-kiss2-lib/types";
import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";

const MAX_ATTEMPTS = 5;
const MIN_COINS = 1;
const MAX_COINS = 10;

export interface LuckyCoinResult {
	readonly amount: number;
	readonly attemptsLeft: number;
}

export interface LuckyCoinStatus {
	readonly attemptsUsed: number;
	readonly attemptsLeft: number;
}

function randomCoinAmount(): number {
	return Math.floor(Math.random() * (MAX_COINS - MIN_COINS + 1)) + MIN_COINS;
}

export class LuckyCoinService {
	constructor(
		private readonly prisma: PrismaClient,
		private readonly producer: KafkaProducerService,
		private readonly walletApiUrl: string,
		private readonly serviceName: string,
		private readonly logger: FastifyBaseLogger,
	) {}

	async getStatus(userId: string): Promise<LuckyCoinStatus> {
		const attemptsUsed = await this.prisma.luckyCoinAttempt.count({
			where: { userId },
		});

		return {
			attemptsUsed,
			attemptsLeft: Math.max(0, MAX_ATTEMPTS - attemptsUsed),
		};
	}

	async claim(userId: string, analyticsHeaders: AnalyticsHeaders): Promise<LuckyCoinResult> {
		const attemptsUsed = await this.prisma.luckyCoinAttempt.count({
			where: { userId },
		});

		if (attemptsUsed >= MAX_ATTEMPTS) {
			throw new LuckyCoinExhaustedError(userId);
		}

		const amount = randomCoinAmount();

		// Issue coins via global backend wallet API
		await this.issueCoins(userId, amount);

		// Record attempt in local DB
		await this.prisma.luckyCoinAttempt.create({
			data: { userId, amount },
		});

		// Emit event to Kafka
		const eventData = { userId, amount };
		await this.producer.sendCreated("luckyCoin", eventData, analyticsHeaders);

		this.logger.info(
			{ userId, amount, attemptsLeft: MAX_ATTEMPTS - attemptsUsed - 1 },
			"Lucky coin claimed",
		);

		return {
			amount,
			attemptsLeft: MAX_ATTEMPTS - attemptsUsed - 1,
		};
	}

	private async issueCoins(userId: string, amount: number): Promise<void> {
		const url = `${this.walletApiUrl}/api/v1/userBalance/transaction`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Forward-Role": "admin",
				"X-Forward-User-Id": userId,
			},
			body: JSON.stringify([
				{
					userId,
					type: "coin",
					quantity: amount,
					source: `${this.serviceName}.lucky-coin`,
				},
			]),
		});

		if (!response.ok) {
			const text = await response.text();
			this.logger.error(
				{ userId, amount, status: response.status, body: text },
				"Failed to issue coins via wallet API",
			);
			throw new Error(`Wallet API returned ${response.status}: ${text}`);
		}
	}
}

export class LuckyCoinExhaustedError extends Error {
	constructor(userId: string) {
		super(`User ${userId} has exhausted all lucky coin attempts`);
		this.name = "LuckyCoinExhaustedError";
	}
}

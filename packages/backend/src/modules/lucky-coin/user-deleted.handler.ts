import type { MessageHandler, TopicSubscription } from "@playneta/node-kiss2-lib/services";
import type { FastifyBaseLogger } from "fastify";

import type { PrismaClient } from "../../generated/prisma/client.js";

export interface UserDeletedHandlerDeps {
	readonly logger: FastifyBaseLogger;
	readonly prisma: PrismaClient;
}

interface UserDeletedEnvelope {
	readonly payload?: {
		readonly old?: { readonly id?: string };
	};
}

/**
 * On `user.deleted`: scrub every reference to the deleted user from local
 * state. The template only stores `LuckyCoinAttempt` rows keyed by userId —
 * no in-flight money, no participant lists. Real miniapps that hold open
 * bets / orders / escrow MUST extend this handler to refund counterparties
 * before deleting the rows; once the rows are gone there is no way to find
 * the user again.
 *
 * Order rule (kept here so it is not lost when the handler grows): DB delete
 * commits first, wallet refund is fired after. Kafka redelivery is routine,
 * and the wallet `source` is flat per-miniapp (no per-transaction
 * idempotency), so refunding-then-deleting risks double-refund on
 * redelivery. Deleting first means the redelivered event finds zero rows
 * and skips.
 */
export function buildUserDeletedHandler(deps: UserDeletedHandlerDeps): TopicSubscription {
	const { logger, prisma } = deps;

	const handler: MessageHandler = async ({ message, topic, partition }) => {
		const raw = message.value?.toString() ?? null;
		if (!raw) {
			logger.warn({ topic, partition }, "user.deleted: empty message — skip");
			return;
		}

		let envelope: UserDeletedEnvelope;
		try {
			envelope = JSON.parse(raw) as UserDeletedEnvelope;
		} catch (err) {
			logger.error({ err, topic, partition }, "user.deleted: JSON parse failed — skip");
			return;
		}

		const deletedUserId = envelope.payload?.old?.id;
		if (!deletedUserId) {
			logger.warn({ topic, partition }, "user.deleted: missing payload.old.id — skip");
			return;
		}

		const result = await prisma.luckyCoinAttempt.deleteMany({
			where: { userId: deletedUserId },
		});

		logger.info(
			{ deletedUserId, deletedCount: result.count },
			"user.deleted: scrubbed local state",
		);
	};

	return {
		getTopic: () => "user.deleted",
		getHandler: () => handler,
	};
}

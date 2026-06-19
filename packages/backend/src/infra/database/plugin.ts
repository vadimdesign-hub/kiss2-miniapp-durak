import fp from "fastify-plugin";
import { PrismaClient } from "../../generated/prisma/client.js";

export interface DatabasePluginOptions {
	databaseUrl: string;
}

declare module "fastify" {
	interface FastifyInstance {
		prisma: PrismaClient;
	}
}

export const databasePlugin = fp<DatabasePluginOptions>(
	async (fastify, opts) => {
		const prisma = new PrismaClient({
			datasourceUrl: opts.databaseUrl,
			log:
				process.env.NODE_ENV === "development"
					? [
							{ level: "query", emit: "event" },
							{ level: "error", emit: "stdout" },
						]
					: [{ level: "error", emit: "stdout" }],
		});

		await prisma.$connect();
		fastify.log.info("Database connected");

		fastify.decorate("prisma", prisma);

		fastify.addHook("onClose", async () => {
			await prisma.$disconnect();
			fastify.log.info("Database disconnected");
		});
	},
	{
		name: "database",
		fastify: "5.x",
	},
);

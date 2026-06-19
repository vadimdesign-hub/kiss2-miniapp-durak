import type { FastifyPluginAsync } from "fastify";

const MESSAGES = ["Lucky Day", "Big Win", "Stay Gold", "Game On"] as const;
const INTERVAL_MS = 10_000;
const AUTH_TIMEOUT_MS = 5_000;

function decodeJwtPayload(token: string): { sub?: string; role?: string } {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Invalid JWT format");
	const base64 = parts[1];
	if (!base64) throw new Error("Invalid JWT format");
	return JSON.parse(Buffer.from(base64, "base64url").toString("utf-8")) as {
		sub?: string;
		role?: string;
	};
}

export const dailyMessageRoutes: FastifyPluginAsync = async (fastify) => {
	fastify.get("/dailyMessage", { websocket: true }, (socket) => {
		let authTimer: ReturnType<typeof setTimeout> | null = null;
		let authenticated = false;

		// Wait for auth message before starting the broadcast
		authTimer = setTimeout(() => {
			socket.send(JSON.stringify({ error: "Auth timeout" }));
			socket.close();
		}, AUTH_TIMEOUT_MS);

		socket.on("message", (raw: Buffer) => {
			if (authenticated) return;

			if (authTimer) {
				clearTimeout(authTimer);
				authTimer = null;
			}

			try {
				const data = JSON.parse(raw.toString()) as { token?: string };
				const token = data.token;
				if (!token) {
					socket.send(JSON.stringify({ error: "Missing token" }));
					socket.close();
					return;
				}

				const claims = decodeJwtPayload(token);
				if (!claims.sub) {
					socket.send(JSON.stringify({ error: "Invalid token" }));
					socket.close();
					return;
				}

				authenticated = true;
				startBroadcast();
			} catch {
				socket.send(JSON.stringify({ error: "Invalid auth message" }));
				socket.close();
			}
		});

		function startBroadcast() {
			let index = 0;

			const send = () => {
				const message = MESSAGES[index % MESSAGES.length];
				socket.send(JSON.stringify({ message, index: index % MESSAGES.length }));
				index += 1;
			};

			send();

			const timer = setInterval(send, INTERVAL_MS);

			socket.on("close", () => {
				clearInterval(timer);
			});

			socket.on("error", () => {
				clearInterval(timer);
			});
		}

		socket.on("close", () => {
			if (authTimer) clearTimeout(authTimer);
		});
	});
};

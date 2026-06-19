import { useFlutterBridge } from "@playneta/flutter-js-bridge";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "~/config";

interface DailyMessageState {
	readonly message: string | null;
	readonly connected: boolean;
}

export function useDailyMessage(): DailyMessageState {
	const [message, setMessage] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const { state } = useFlutterBridge();
	const authorization = state.headers?.authorization ?? null;

	const connect = useCallback(() => {
		if (!authorization) return;

		const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : authorization;

		// Build WS URL from the API base
		const isAbsolute = API_BASE_URL.startsWith("http");
		const httpBase = isAbsolute ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
		const wsBase = httpBase.replace(/^http/, "ws");
		const url = `${wsBase}/api/v1/dailyMessage`;

		const ws = new WebSocket(url);
		wsRef.current = ws;

		ws.onopen = () => {
			// Browser WebSocket API does not support custom headers, so we
			// authenticate via first-message pattern instead of query params
			// (tokens in URLs can leak through logs and referrer headers).
			ws.send(JSON.stringify({ token }));
			setConnected(true);
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.error) {
					ws.close();
					return;
				}
				setMessage(data.message);
			} catch {
				// ignore malformed messages
			}
		};

		ws.onclose = () => {
			setConnected(false);
			wsRef.current = null;
			reconnectTimerRef.current = setTimeout(connect, 3_000);
		};

		ws.onerror = () => {
			ws.close();
		};
	}, [authorization]);

	useEffect(() => {
		connect();

		return () => {
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current);
			}
			wsRef.current?.close();
		};
	}, [connect]);

	return { message, connected };
}

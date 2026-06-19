import { FlutterBridgeProvider } from "@playneta/flutter-js-bridge";
import * as Sentry from "@sentry/react";
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	isRouteErrorResponse,
} from "react-router";

import { GLOBAL_BACKEND_BASE_URL } from "~/config";
import type { Route } from "./+types/root";
import "./app.css";
import "./instrument";

export const links: Route.LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export function HydrateFallback() {
	return (
		<div className="flex items-center justify-center min-h-screen bg-[#1a1a1a]">
			<div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-600 border-t-orange-400" />
		</div>
	);
}

export default function App() {
	return (
		<FlutterBridgeProvider
			apiBaseUrl={GLOBAL_BACKEND_BASE_URL}
			localMode={import.meta.env.DEV}
			fallback={
				<div className="flex items-center justify-center min-h-screen bg-[#1a1a1a]">
					<div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-600 border-t-orange-400" />
				</div>
			}
		>
			<Outlet />
		</FlutterBridgeProvider>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Oops!";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "404" : "Error";
		details =
			error.status === 404 ? "The requested page could not be found." : error.statusText || details;
	} else if (error && error instanceof Error) {
		Sentry.captureException(error);
		details = import.meta.env.DEV ? error.message : "An unexpected error occurred.";
		stack = import.meta.env.DEV ? error.stack : undefined;
	}

	return (
		<main className="pt-16 p-4 container mx-auto">
			<h1>{message}</h1>
			<p>{details}</p>
			{stack && (
				<pre className="w-full p-4 overflow-x-auto">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}

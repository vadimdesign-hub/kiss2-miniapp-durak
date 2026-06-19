import type { Config } from "@react-router/dev/config";

const serviceName = process.env.VITE_SERVICE_NAME || "";
const basename = serviceName ? `/${serviceName}/` : "/";

export default {
	// SPA mode — produces a static build with index.html
	ssr: false,
	basename,
} satisfies Config;

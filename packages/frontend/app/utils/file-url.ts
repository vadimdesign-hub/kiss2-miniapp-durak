import { GLOBAL_BACKEND_BASE_URL } from "~/config";

type FileURLResource = "assets" | "public" | "private";

interface FileURL {
	readonly path: string;
	readonly resource: FileURLResource;
}

const RESOURCE_URLS: Record<FileURLResource, { readonly prod: string; readonly stage: string }> = {
	assets: {
		prod: "https://assets-prod.kisskissplay.com",
		stage: "https://assets-stage.kisskissplay.com",
	},
	public: {
		prod: "https://public-prod.kisskissplay.com",
		stage: "https://public-stage.kisskissplay.com",
	},
	private: {
		prod: "https://private-prod.kisskissplay.com",
		stage: "https://private-stage.kisskissplay.com",
	},
};

const isProd =
	GLOBAL_BACKEND_BASE_URL.includes("-prod") || GLOBAL_BACKEND_BASE_URL.includes(".prod");

export function buildFileUrl(fileUrl: FileURL): string {
	const base = isProd
		? RESOURCE_URLS[fileUrl.resource].prod
		: RESOURCE_URLS[fileUrl.resource].stage;
	return `${base}/${fileUrl.path}`;
}

export async function resolveFileUrl(
	fileId: string,
	bridgeFetch: typeof fetch,
): Promise<string | null> {
	try {
		const res = await bridgeFetch(`${GLOBAL_BACKEND_BASE_URL}/file/api/v1/file/${fileId}`);
		if (!res.ok) return null;

		const data = (await res.json()) as {
			fileUrl: FileURL;
			thumbnails?: ReadonlyArray<{ fileUrl: FileURL; size: string }>;
		};

		const thumbnail = data.thumbnails?.find((t) => t.size === "256x256");
		const targetFileUrl = thumbnail?.fileUrl ?? data.fileUrl;

		return buildFileUrl(targetFileUrl);
	} catch {
		return null;
	}
}

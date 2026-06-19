import { a } from "~/utils/asset-url";

export function CrystalIcon({ size = 20 }: { size?: number }) {
	return (
		<img
			src={a("/diamond.png")}
			alt="crystal"
			width={size}
			height={size}
			style={{ display: "inline-block", objectFit: "contain", flexShrink: 0 }}
		/>
	);
}

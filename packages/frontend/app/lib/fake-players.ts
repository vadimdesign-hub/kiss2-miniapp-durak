const NAMES = [
	"Алексей К.", "Мария В.", "Дмитрий П.", "Анна С.", "Сергей М.",
	"Екатерина Р.", "Андрей Л.", "Наталья Б.", "Павел Ж.", "Ольга Т.",
	"Максим И.", "Юлия К.", "Артём Н.", "Виктория Д.", "Иван Ш.",
	"Кристина Е.", "Никита Ф.", "Татьяна Г.", "Роман А.", "Светлана М.",
	"Кирилл З.", "Валерия О.", "Денис Х.", "Полина С.", "Владимир Ю.",
];

const GRADIENTS = [
	["#e74c3c", "#c0392b"],
	["#e67e22", "#d35400"],
	["#f1c40f", "#d4ac0d"],
	["#2ecc71", "#27ae60"],
	["#1abc9c", "#16a085"],
	["#3498db", "#2980b9"],
	["#9b59b6", "#8e44ad"],
	["#e91e63", "#c2185b"],
	["#00bcd4", "#0097a7"],
	["#ff5722", "#e64a19"],
	["#607d8b", "#455a64"],
	["#795548", "#5d4037"],
];

function hash(str: string): number {
	let h = 0;
	for (const c of str) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
	return Math.abs(h);
}

export interface FakePlayer {
	name: string;
	initials: string;
	gradientFrom: string;
	gradientTo: string;
}

export function getFakePlayer(seed: string): FakePlayer {
	const h = hash(seed);
	const name = NAMES[h % NAMES.length];
	const [gradientFrom, gradientTo] = GRADIENTS[(h >>> 4) % GRADIENTS.length];
	const parts = name.split(" ");
	const initials = (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
	return { name, initials, gradientFrom, gradientTo };
}

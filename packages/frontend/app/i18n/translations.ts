const translations = {
	en: {
		coins: "coins",
		loading: "Loading...",
		error: "Something went wrong",
		// Hub
		hubTitle: "Game Hub",
		leaderboard: "Leaderboard",
		playButton: "Play",
		onlinePlayers: (n: number) => `${n} online`,
		// Games
		checkers: "Checkers",
		checkersDesc: "Russian checkers, 8×8 board",
		durak: "Durak",
		durakDesc: "Classic Russian card game",
		// Match lobby
		players: "Players",
		stakeLabel: "Stake",
		noPlayersOnline: "No players online yet",
		yourStake: "Your Stake",
		play: "Play",
		playWithBot: "Play vs Bot",
		playerFallback: "Player",
		inGame: "In Game",
		inQueue: "Waiting",
		makingStake: "Setting stake",
		allBusy: "All players are currently busy. You can play against the bot.",
		rules: "Rules",
		rulesOk: "Got it",
		// Searching
		searching: "Finding opponent...",
		cancelSearch: "Cancel",
		searchTimeout: "No opponent found. Try again?",
		waitingForOpponent: "Looking for an opponent…",
		connectionError: "Connection error",
		searchStatus: (elapsed: number, waiting: number, online: number) => `${elapsed}s · queued: ${waiting} · online: ${online}`,
		// In-game
		yourTurn: "Your Turn",
		opponentTurn: "Opponent's Turn",
		waitingForPlayer: "Waiting for player…",
		noCards: "No cards",
		pass: "Pass",
		takeCards: "Take cards",
		// Exit dialog
		exitGameTitle: "Exit game?",
		exitWithStakePenalty: (stake: number) => `This will count as a defeat: you will lose ${stake.toLocaleString()} coins`,
		exitNoPenalty: "This will count as a defeat",
		exitNoOpponent: "Opponent hasn't joined yet — exit without penalty",
		exit: "Exit",
		cancel: "Cancel",
		// Game over
		botResultTitle: "Play vs Bot Again?",
		youWon: "You Won!",
		youLost: "You Lost",
		draw: "Draw",
		playAgain: "Play Again",
		toLobby: "To Lobby",
		backToMenu: "Back to Menu",
		coinsEarned: (n: number) => `+${n} coins`,
	},
	ru: {
		coins: "монеты",
		loading: "Загрузка...",
		error: "Что-то пошло не так",
		// Hub
		hubTitle: "Игровой хаб",
		leaderboard: "Таблица лидеров",
		playButton: "Играть",
		onlinePlayers: (n: number) => `${n} онлайн`,
		// Games
		checkers: "Шашки",
		checkersDesc: "Русские шашки, доска 8×8",
		durak: "Дурак",
		durakDesc: "Классическая карточная игра",
		// Match lobby
		players: "Игроки",
		stakeLabel: "Ставка",
		noPlayersOnline: "Пока никого нет онлайн",
		yourStake: "Ваша ставка",
		play: "Играть",
		playWithBot: "Играть с ботом",
		playerFallback: "Игрок",
		inGame: "В игре",
		inQueue: "В ожидании",
		makingStake: "Делает ставку",
		allBusy: "На данный момент все игроки заняты, вы можете сыграть с ботом.",
		rules: "Правила",
		rulesOk: "Понятно",
		// Searching
		searching: "Ищем соперника...",
		cancelSearch: "Отмена",
		searchTimeout: "Соперник не найден. Попробовать снова?",
		waitingForOpponent: "Ожидаем соперника…",
		connectionError: "Ошибка подключения",
		searchStatus: (elapsed: number, waiting: number, online: number) => `${elapsed}с · в очереди: ${waiting} · онлайн: ${online}`,
		// In-game
		yourTurn: "Ваш ход",
		opponentTurn: "Ход соперника",
		waitingForPlayer: "Ожидаем игрока…",
		noCards: "Нет карт",
		pass: "Пас",
		takeCards: "Взять карты",
		// Exit dialog
		exitGameTitle: "Выйти из игры?",
		exitWithStakePenalty: (stake: number) => `Это засчитается как поражение: вы потеряете ${stake.toLocaleString()} монет`,
		exitNoPenalty: "Это засчитается как поражение",
		exitNoOpponent: "Соперник ещё не присоединился — выход без потерь",
		exit: "Выйти",
		cancel: "Отмена",
		// Game over
		botResultTitle: "Играть с ботом ещё раз?",
		youWon: "Вы победили!",
		youLost: "Вы проиграли",
		draw: "Ничья",
		playAgain: "Играть ещё",
		toLobby: "В лобби",
		backToMenu: "В меню",
		coinsEarned: (n: number) => `+${n} монет`,
	},
} as const;

export type Lang = keyof typeof translations;
export type Translations = (typeof translations)[Lang];
export type GameType = "durak";

export function getTranslations(lang: string): Translations {
	if (lang.startsWith("ru")) return translations.ru;
	return translations.en;
}

export interface DurakRule { text: string; isCommission?: boolean; }

const DURAK_RULES_RU: DurakRule[] = [
	{ text: "Цель — избавиться от всех карт. Последний с картами на руках — Дурак." },
	{ text: "Защитник бьёт атаку картой той же масти старшего достоинства или козырем." },
	{ text: "Не можешь отбиться — «Взять». Все отбито — атакующий жмёт «Пас», роли меняются." },
	{ text: "После раунда оба добирают карты из колоды до 6 штук." },
	{ text: "Если не сделать ход за 30 секунд — поражение. Победитель получает ставку соперника, проигравший теряет свою ставку." },
	{ text: "Комиссия 10%. Например, при ставке 100 монет ты выиграл в раунде — получишь в качестве приза 90 монет (10 монет — комиссия).", isCommission: true },
];

const DURAK_RULES_EN: DurakRule[] = [
	{ text: "Goal: get rid of all your cards. The last player holding cards is the Durak (Fool)." },
	{ text: "The defender beats an attack with a card of the same suit and higher rank, or any trump card." },
	{ text: "Can't defend? Tap «Take». All cards beaten? Attacker taps «Pass» and roles switch." },
	{ text: "After each round both players draw back up to 6 cards from the deck." },
	{ text: "Fail to make a move within 30 seconds — you lose. The winner receives the loser's stake." },
	{ text: "10% commission. For example, with a stake of 100 coins, if you win the round you receive 90 coins as the prize (10 coins — commission).", isCommission: true },
];

export function getDurakRules(lang: string): DurakRule[] {
	return lang.startsWith("ru") ? DURAK_RULES_RU : DURAK_RULES_EN;
}

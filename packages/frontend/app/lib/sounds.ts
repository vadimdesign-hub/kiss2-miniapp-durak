let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
	try {
		if (!ctx || ctx.state === "closed") ctx = new AudioContext();
		if (ctx.state === "suspended") ctx.resume();
		return ctx;
	} catch {
		return null;
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function osc(
	c: AudioContext,
	type: OscillatorType,
	freq0: number,
	freq1: number,
	dur: number,
	gain0: number,
	gain1: number,
	startAt = 0,
): void {
	const now = c.currentTime + startAt;
	const o = c.createOscillator();
	const g = c.createGain();
	o.type = type;
	o.frequency.setValueAtTime(freq0, now);
	o.frequency.exponentialRampToValueAtTime(freq1, now + dur);
	g.gain.setValueAtTime(gain0, now);
	g.gain.exponentialRampToValueAtTime(gain1, now + dur);
	o.connect(g);
	g.connect(c.destination);
	o.start(now);
	o.stop(now + dur + 0.01);
}

function noise(
	c: AudioContext,
	filterType: BiquadFilterType,
	freq0: number,
	freq1: number,
	dur: number,
	gain0: number,
	gain1: number,
	Q = 1.5,
	startAt = 0,
): void {
	const now = c.currentTime + startAt;
	const bufSize = Math.ceil(c.sampleRate * dur);
	const buf = c.createBuffer(1, bufSize, c.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
	const src = c.createBufferSource();
	src.buffer = buf;
	const f = c.createBiquadFilter();
	f.type = filterType;
	f.Q.value = Q;
	f.frequency.setValueAtTime(freq0, now);
	f.frequency.exponentialRampToValueAtTime(freq1, now + dur);
	const g = c.createGain();
	g.gain.setValueAtTime(gain0, now);
	g.gain.exponentialRampToValueAtTime(gain1, now + dur);
	src.connect(f);
	f.connect(g);
	g.connect(c.destination);
	src.start(now);
	src.stop(now + dur);
}

// ── Card played from hand (вжжжух — fast air whoosh) ─────────────────────────
export function playCardPlay() {
	const c = ac();
	if (!c) return;
	// Main whoosh sweep: high → low, fast
	noise(c, "bandpass", 4800, 180, 0.18, 0.35, 0.001, 2.5);
	// Harmonic body layer
	noise(c, "bandpass", 2400, 90, 0.18, 0.18, 0.001, 1.2, 0.02);
	// Sharp attack transient
	osc(c, "sawtooth", 2200, 120, 0.06, 0.22, 0.001);
}

// ── Bot card flies onto table (вжжжух downward) ───────────────────────────────
export function playBotCardFly() {
	const c = ac();
	if (!c) return;
	// Fast descending whoosh
	noise(c, "bandpass", 5000, 160, 0.22, 0.3, 0.001, 2.2);
	noise(c, "bandpass", 2600, 80, 0.20, 0.16, 0.001, 1.4, 0.02);
	// Landing thud
	osc(c, "sine", 160, 55, 0.1, 0.28, 0.001, 0.18);
}

// ── Defense card placed on attack card (satisfying slap) ─────────────────────
export function playCardBeat() {
	const c = ac();
	if (!c) return;
	// Sharp smack transient
	osc(c, "sawtooth", 1100, 180, 0.05, 0.28, 0.001);
	// Low body thud
	osc(c, "sine", 320, 55, 0.15, 0.5, 0.001, 0.01);
	// Papery crack
	noise(c, "highpass", 4000, 1200, 0.06, 0.15, 0.001, 1.2, 0.0);
}

// ── Cards fly off table (pass — fly to opponent) ─────────────────────────────
export function playTableFlyOpp() {
	const c = ac();
	if (!c) return;
	// Ascending whoosh
	noise(c, "bandpass", 600, 3500, 0.4, 0.3, 0.001, 1.6);
	// Thin high tail
	osc(c, "triangle", 800, 2400, 0.3, 0.1, 0.001, 0.05);
}

// ── Cards fly to player (take) ────────────────────────────────────────────────
export function playTableFlyMe() {
	const c = ac();
	if (!c) return;
	// Descending cascade whoosh
	noise(c, "bandpass", 3000, 400, 0.45, 0.32, 0.001, 1.5);
	// Dull "pile lands" thud
	osc(c, "sine", 140, 45, 0.18, 0.4, 0.001, 0.38);
}

// ── Wooden checker thud — solid, satisfying ─────────────────────────────────
export function playMove() {
	const c = ac();
	if (!c) return;
	// Sharp wooden attack transient (the "click" of contact)
	osc(c, "square", 1400, 380, 0.04, 0.55, 0.001);
	// Mid-body thud
	osc(c, "sine", 320, 95, 0.12, 0.85, 0.001);
	// Low bass body — gives weight
	osc(c, "sine", 140, 60, 0.18, 0.6, 0.001, 0.005);
	// Wooden surface texture
	noise(c, "bandpass", 2400, 600, 0.06, 0.22, 0.001, 1.8);
}

// ── Heavier impact — legacy ───────────────────────────────────────────────────
export function playCapture() {
	const c = ac();
	if (!c) return;
	osc(c, "triangle", 380, 55, 0.14, 0.55, 0.001);
	osc(c, "sawtooth", 900, 200, 0.03, 0.2, 0.001);
}

// ── Whoosh — legacy ───────────────────────────────────────────────────────────
export function playFlyOff() {
	playTableFlyOpp();
}

// ── Piece placed on board (soft wooden tap) ───────────────────────────────────
export function playPieceDrop() {
	const c = ac();
	if (!c) return;
	osc(c, "sine", 420, 180, 0.07, 0.32, 0.001);
	noise(c, "highpass", 3000, 800, 0.05, 0.1, 0.001, 1.2);
}

// ── Picking up a checker piece (light wooden tap) ────────────────────────────
export function playPiecePickup() {
	const c = ac();
	if (!c) return;
	// Soft, quick pluck
	osc(c, "sine", 880, 540, 0.05, 0.22, 0.001);
	osc(c, "triangle", 1320, 880, 0.04, 0.12, 0.001);
	noise(c, "highpass", 4500, 2500, 0.03, 0.08, 0.001, 1.5);
}

// ── Cards swept off the table — long airy whoosh "вшшууух" ────────────────────
export function playCardSweep() {
	const c = ac();
	if (!c) return;
	// Two staggered descending whoosh layers — gives a long, airy 'вшшууух'
	noise(c, "bandpass", 5500, 220, 0.55, 0.32, 0.001, 1.4);
	noise(c, "bandpass", 3200, 120, 0.55, 0.20, 0.001, 1.0, 0.05);
	// Soft tail that lingers like the cards land in a pile somewhere off-screen
	osc(c, "sine", 220, 90, 0.25, 0.18, 0.001, 0.35);
}

// ── Crystal ping — short sparkle for +10 crystal pickups ─────────────────────
export function playCrystalPing() {
	const c = ac();
	if (!c) return;
	// Bright two-tone bell
	osc(c, "triangle", 1760, 2349, 0.12, 0.18, 0.001);            // A6 → D7
	osc(c, "sine",     2637, 2637, 0.18, 0.10, 0.001, 0.04);      // E7 sustain
	// Tiny shimmer tail
	osc(c, "sine",     3520, 4186, 0.20, 0.08, 0.001, 0.08);      // A7 → C8
}

// ── Crystal debit — lower, softer for −5 deductions ──────────────────────────
export function playCrystalDebit() {
	const c = ac();
	if (!c) return;
	osc(c, "triangle", 880, 440, 0.20, 0.16, 0.001);
	osc(c, "sine",     220, 160, 0.18, 0.14, 0.001, 0.05);
}

// ── Win fanfare — cheerful ascending arpeggio + shimmer ───────────────────────
export function playWin() {
	const c = ac();
	if (!c) return;
	// Major arpeggio C-E-G-C (fifth) — uplifting
	const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
	notes.forEach((f, i) => {
		osc(c, "triangle", f, f, 0.18, 0.28, 0.001, i * 0.12);
		osc(c, "sine",     f * 2, f * 2, 0.14, 0.12, 0.001, i * 0.12);
	});
	// Sparkle shimmer on top at the end
	osc(c, "sine", 2093, 2637, 0.35, 0.18, 0.001, 0.48); // C7→E7
	osc(c, "sine", 1568, 2093, 0.25, 0.12, 0.001, 0.55); // G6→C7
}

// ── Lose melody — descending minor, soft ──────────────────────────────────────
export function playLose() {
	const c = ac();
	if (!c) return;
	// Descending sad notes A4 - F4 - D4 - A3 (minor feel)
	const notes = [440.00, 349.23, 293.66, 220.00];
	notes.forEach((f, i) => {
		osc(c, "triangle", f, f * 0.98, 0.28, 0.22, 0.001, i * 0.18);
		osc(c, "sine",     f * 0.5, f * 0.5, 0.25, 0.08, 0.001, i * 0.18);
	});
	// Soft low bass hit at the end
	osc(c, "sine", 120, 55, 0.5, 0.2, 0.001, 0.75);
}

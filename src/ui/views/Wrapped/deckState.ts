// Small shared state for the deck viewer: whether the quiz round and "no spoilers" are on (remembered in localStorage), and the quiz answers of the deck being played.
import { useSyncExternalStore } from "react";
import { safeLocalStorage } from "../../util/safeLocalStorage.ts";

const listeners = new Set<() => void>();
const emit = () => {
	for (const l of listeners) {
		l();
	}
};
const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => {
		listeners.delete(l);
	};
};

const KEYS = { quiz: "wrappedQuiz", noSpoil: "wrappedNoSpoil" } as const;

const read = (key: string, fallback: boolean) => {
	try {
		const v = safeLocalStorage.getItem(key);
		return v === null ? fallback : v === "1";
	} catch {
		return fallback;
	}
};

export type DeckPrefs = { quiz: boolean; noSpoil: boolean };

let prefs: DeckPrefs = {
	quiz: read(KEYS.quiz, true),
	noSpoil: read(KEYS.noSpoil, false),
};

export const setDeckPref = (k: keyof DeckPrefs, v: boolean) => {
	prefs = { ...prefs, [k]: v };
	try {
		safeLocalStorage.setItem(KEYS[k], v ? "1" : "0");
	} catch {
		// Not remembered, still applies for this visit
	}
	emit();
};

export const useDeckPrefs = () =>
	useSyncExternalStore(
		subscribe,
		() => prefs,
		() => prefs,
	);

// Quiz answers by deck key then slide id: which option was picked and whether it was right
type Answer = { pick: number; ok: boolean };
let answers = new Map<string, Answer>();
let answersVersion = 0;

const key = (deck: string, id: string) => `${deck}|${id}`;

export const answerQuiz = (deck: string, id: string, a: Answer) => {
	if (!answers.has(key(deck, id))) {
		answers = new Map(answers).set(key(deck, id), a);
		answersVersion += 1;
		emit();
	}
};

export const resetQuiz = (deck: string) => {
	answers = new Map([...answers].filter(([k]) => !k.startsWith(`${deck}|`)));
	answersVersion += 1;
	emit();
};

export const useQuizAnswers = () => {
	useSyncExternalStore(
		subscribe,
		() => answersVersion,
		() => answersVersion,
	);
	return (deck: string, id: string) => answers.get(key(deck, id));
};

export const DAILY_GOAL = 3;
export const COINS_PER_STUDY = 5;
export const DAILY_GOAL_BONUS_COINS = 15;
export const COINS_PER_LEVEL = 100;
export const LEARNING_PROGRESS_STORAGE_KEY = "wordpick-learning-progress-v1";

export type LearningProgress = {
  coins: number;
  dailyDate: string;
  todayWords: string[];
};

export type StudyOutcome = {
  progress: LearningProgress;
  changed: boolean;
  awardedCoins: number;
  questCompleted: boolean;
};

export function getLocalDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeWord(word: string): string {
  return word.trim().toLocaleLowerCase();
}

export function createEmptyLearningProgress(today = getLocalDayKey()): LearningProgress {
  return {
    coins: 0,
    dailyDate: today,
    todayWords: [],
  };
}

export function hydrateLearningProgress(raw: unknown, today = getLocalDayKey()): LearningProgress {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return createEmptyLearningProgress(today);
  }

  const saved = raw as Partial<LearningProgress> & { xp?: unknown };
  const storedBalance = typeof saved.coins === "number" ? saved.coins : saved.xp;
  const coins = typeof storedBalance === "number" && Number.isFinite(storedBalance)
    ? Math.max(0, Math.floor(storedBalance))
    : 0;
  const todayWords = saved.dailyDate === today && Array.isArray(saved.todayWords)
    ? [...new Set(saved.todayWords.filter((word): word is string => typeof word === "string").map(normalizeWord).filter(Boolean))]
    : [];

  return {
    coins,
    dailyDate: today,
    todayWords,
  };
}

export function readLearningProgress(): LearningProgress {
  const today = getLocalDayKey();
  if (typeof window === "undefined") return createEmptyLearningProgress(today);

  try {
    const serialized = window.localStorage.getItem(LEARNING_PROGRESS_STORAGE_KEY);
    return hydrateLearningProgress(serialized ? JSON.parse(serialized) as unknown : null, today);
  } catch {
    return createEmptyLearningProgress(today);
  }
}

export function saveLearningProgress(progress: LearningProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEARNING_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Keep the study session usable when browser storage is disabled or full.
  }
}

export function getTodayWordCount(progress: LearningProgress, today = getLocalDayKey()): number {
  return progress.dailyDate === today ? progress.todayWords.length : 0;
}

export function getDailyEnergy(progress: LearningProgress, today = getLocalDayKey()): number {
  return Math.min(DAILY_GOAL, getTodayWordCount(progress, today));
}

export function hasStudiedToday(progress: LearningProgress, word: string, today = getLocalDayKey()): boolean {
  return progress.dailyDate === today && progress.todayWords.includes(normalizeWord(word));
}

export function recordWordStudy(progress: LearningProgress, word: string, today = getLocalDayKey()): StudyOutcome {
  const normalized = normalizeWord(word);
  if (!normalized) return { progress, changed: false, awardedCoins: 0, questCompleted: false };

  const currentWords = progress.dailyDate === today ? progress.todayWords : [];
  if (currentWords.includes(normalized)) {
    return { progress, changed: false, awardedCoins: 0, questCompleted: false };
  }

  const questWasComplete = currentWords.length >= DAILY_GOAL;
  const todayWords = [...currentWords, normalized];
  const questCompleted = !questWasComplete && todayWords.length >= DAILY_GOAL;
  const awardedCoins = COINS_PER_STUDY + (questCompleted ? DAILY_GOAL_BONUS_COINS : 0);

  return {
    progress: {
      coins: progress.coins + awardedCoins,
      dailyDate: today,
      todayWords,
    },
    changed: true,
    awardedCoins,
    questCompleted,
  };
}

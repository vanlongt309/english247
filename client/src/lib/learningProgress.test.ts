import { describe, expect, it } from "vitest";
import {
  COINS_PER_STUDY,
  DAILY_GOAL,
  DAILY_GOAL_BONUS_COINS,
  createEmptyLearningProgress,
  getDailyEnergy,
  hydrateLearningProgress,
  recordWordStudy,
} from "./learningProgress";

const TODAY = "2026-10-26";
const YESTERDAY = "2026-10-25";

describe("learning progress", () => {
  it("awards coins once per unique word per local day", () => {
    const first = recordWordStudy(createEmptyLearningProgress(TODAY), "look after", TODAY);
    const duplicate = recordWordStudy(first.progress, "LOOK AFTER", TODAY);

    expect(first.changed).toBe(true);
    expect(first.awardedCoins).toBe(COINS_PER_STUDY);
    expect(first.progress.todayWords).toEqual(["look after"]);
    expect(duplicate.changed).toBe(false);
    expect(duplicate.awardedCoins).toBe(0);
    expect(duplicate.progress.coins).toBe(COINS_PER_STUDY);
  });

  it("awards the daily coin bonus exactly when the third unique word is studied", () => {
    let progress = createEmptyLearningProgress(TODAY);
    progress = recordWordStudy(progress, "one", TODAY).progress;
    progress = recordWordStudy(progress, "two", TODAY).progress;
    const third = recordWordStudy(progress, "three", TODAY);
    const fourth = recordWordStudy(third.progress, "four", TODAY);

    expect(DAILY_GOAL).toBe(3);
    expect(third.questCompleted).toBe(true);
    expect(third.awardedCoins).toBe(COINS_PER_STUDY + DAILY_GOAL_BONUS_COINS);
    expect(third.progress.coins).toBe(30);
    expect(fourth.questCompleted).toBe(false);
    expect(fourth.awardedCoins).toBe(COINS_PER_STUDY);
  });

  it("charges daily energy with unique study progress, resets it on a new day and never blocks study", () => {
    let progress = createEmptyLearningProgress(TODAY);
    expect(getDailyEnergy(progress, TODAY)).toBe(0);
    progress = recordWordStudy(progress, "one", TODAY).progress;
    progress = recordWordStudy(progress, "two", TODAY).progress;
    progress = recordWordStudy(progress, "three", TODAY).progress;
    expect(getDailyEnergy(progress, TODAY)).toBe(DAILY_GOAL);

    const fourth = recordWordStudy(progress, "four", TODAY);
    expect(fourth.changed).toBe(true);
    expect(getDailyEnergy(fourth.progress, TODAY)).toBe(DAILY_GOAL);
    expect(getDailyEnergy(fourth.progress, "2026-10-27")).toBe(0);
  });

  it("preserves legacy XP as the opening coin balance and resets only today's word list", () => {
    const hydrated = hydrateLearningProgress({
      xp: 120,
      streak: 3,
      lastActiveDate: YESTERDAY,
      dailyDate: YESTERDAY,
      todayWords: ["yesterday's word"],
    }, TODAY);

    expect(hydrated.coins).toBe(120);
    expect(hydrated.dailyDate).toBe(TODAY);
    expect(hydrated.todayWords).toEqual([]);
    expect(getDailyEnergy(hydrated, TODAY)).toBe(0);
  });

  it("prefers the new coin balance if both legacy and current data are present", () => {
    const hydrated = hydrateLearningProgress({ coins: 55, xp: 120, dailyDate: TODAY, todayWords: [] }, TODAY);
    expect(hydrated.coins).toBe(55);
  });
});

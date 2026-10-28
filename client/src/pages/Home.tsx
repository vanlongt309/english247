import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  BookOpen,
  Check,
  Clipboard,
  FileImage,
  FolderOpen,
  House,
  LoaderCircle,
  RefreshCw,
  ScanLine,
  Sparkles,
  Target,
  TriangleAlert,
  Trophy,
} from "lucide-react";
import {
  DAILY_GOAL,
  DAILY_GOAL_BONUS_COINS,
  getDailyEnergy,
  getLocalDayKey,
  getTodayWordCount,
  hasStudiedToday,
  readLearningProgress,
  recordWordStudy,
  saveLearningProgress,
  COINS_PER_LEVEL,
  COINS_PER_STUDY,
  type LearningProgress,
} from "../lib/learningProgress";

type OcrResult = {
  image: { name: string; mimeType: string; dataUrl: string };
  text: string;
  cacheStatus: "hit" | "saved" | "unavailable";
  modelUsed: string;
};

type MobileTab = "home" | "practice" | "progress";

export default function Home() {
  const [folder, setFolder] = useState("");
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<LearningProgress>(() => readLearningProgress());
  const [studyFeedback, setStudyFeedback] = useState("");
  const [activeTab, setActiveTab] = useState<MobileTab>("home");

  const today = getLocalDayKey();
  const wordsStudiedToday = getTodayWordCount(progress, today);
  const questProgress = Math.min(wordsStudiedToday, DAILY_GOAL);
  const dailyEnergy = getDailyEnergy(progress, today);
  const questCompleted = questProgress >= DAILY_GOAL;
  const questPercent = (questProgress / DAILY_GOAL) * 100;
  const level = Math.floor(progress.coins / COINS_PER_LEVEL) + 1;
  const coinsInLevel = progress.coins % COINS_PER_LEVEL;
  const coinsToNextLevel = COINS_PER_LEVEL - coinsInLevel;
  const levelPercent = (coinsInLevel / COINS_PER_LEVEL) * 100;
  const vocabulary = result?.text.split(/\r?\n/).map((word) => word.trim()).filter(Boolean) ?? [];

  useEffect(() => {
    saveLearningProgress(progress);
  }, [progress]);

  useEffect(() => {
    if (!studyFeedback) return;
    const timeout = window.setTimeout(() => setStudyFeedback(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [studyFeedback]);

  async function pickRandomImage() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/ocr/random", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      const payload = (await response.json()) as OcrResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Không thể quét ảnh lúc này.");
      }
      setResult(payload as OcrResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kết nối bị gián đoạn. Thử lại nhé.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  function markWordStudied(word: string) {
    const studyDay = getLocalDayKey();
    const outcome = recordWordStudy(progress, word, studyDay);
    if (!outcome.changed) return;
    setProgress(outcome.progress);
    setStudyFeedback(
      outcome.questCompleted
        ? `+${outcome.awardedCoins} coins — Daily quest complete!`
        : `+${outcome.awardedCoins} coins — ${word} studied`,
    );
  }

  async function copyText() {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Trình duyệt chưa cho phép sao chép. Bạn có thể bôi đen danh sách từ và cụm từ để copy.");
    }
  }

  return (
    <div className="page-shell">
      <header className="topbar" id="home">
        <a className="brand" href="#home" aria-label="Wordpick trang chủ">
          <span className="brand-mark header-game-mark"><span>W</span><span className="header-level-badge" aria-hidden="true">{level > 99 ? "99+" : level}</span></span>
          <span className="brand-name">wordpick<span>.</span></span>
        </a>
        <div className="topbar-note"><span className="online-dot" /> ENGLISH STUDY DESK <span className="topbar-divider">/</span> 01</div>
        <div className="topbar-stats" aria-label={`${progress.coins} coins, ${dailyEnergy} of ${DAILY_GOAL} daily energy`}>
          <span className="topbar-stat coin-stat" aria-label={`${progress.coins} coins`}><span className="resource-icon-frame"><img className="hud-icon" src="/manus-storage/async-images/OEJzGdgxpnNeQxfkLg6Ga0/image-1.webp" alt="" aria-hidden="true" /><span className="coin-letter" aria-hidden="true">W</span></span><span className="resource-quantity"><strong>{progress.coins}</strong><span className="resource-add-badge" aria-hidden="true">+</span></span></span>
          <span className="topbar-stat energy-stat" aria-label={`${dailyEnergy} of ${DAILY_GOAL} energy today`}><span className="resource-icon-frame"><img className="hud-icon" src="/manus-storage/async-images/HLcXFOjQTDJT7e7kNiY0xW/image-2.webp" alt="" aria-hidden="true" /></span><span className="resource-quantity"><strong>{dailyEnergy}/{DAILY_GOAL}</strong><span className="resource-add-badge" aria-hidden="true">+</span></span></span>
        </div>
        <a className="topbar-link" href="#how-it-works">How it works <ArrowDownRight size={15} /></a>
      </header>

      <main>
        <section className="game-dashboard" id="progress" aria-label="Your learning progress">
          <article className={`quest-card${questCompleted ? " quest-complete" : ""}`}>
            <div className="quest-topline">
              <span className="quest-label"><Target size={14} aria-hidden="true" /> DAILY QUEST</span>
              <span className="quest-bonus">{questCompleted ? "QUEST CLEARED" : `+${DAILY_GOAL_BONUS_COINS} COINS BONUS`}</span>
            </div>
            <div className="quest-copy">
              <div>
                <h1 className="quest-title">Practice 3 words today</h1>
                <p>{questCompleted ? "Daily goal complete. Your next quest starts tomorrow." : "Study words from an image to fill today’s quest."}</p>
              </div>
              <strong className="quest-count">{questProgress}<span>/{DAILY_GOAL}</span></strong>
            </div>
            <div className="quest-meter" role="progressbar" aria-label="Daily quest progress" aria-valuemin={0} aria-valuemax={DAILY_GOAL} aria-valuenow={questProgress}>
              <span style={{ width: `${questPercent}%` }} />
            </div>
            <div className="quest-rewards"><span><img className="reward-icon" src="/manus-storage/async-images/OEJzGdgxpnNeQxfkLg6Ga0/image-1.webp" alt="" aria-hidden="true" /> +{COINS_PER_STUDY} coins per word</span><span>{questCompleted ? "Bonus earned today" : `+${DAILY_GOAL_BONUS_COINS} coins at goal`}</span></div>
          </article>

          <article className="level-card" aria-label="Level and coin balance">
            <div className="level-heading">
              <span className="level-emblem"><Trophy size={17} aria-hidden="true" /></span>
              <span className="level-title"><small>YOUR LEVEL</small><strong>Level {level}</strong></span>
              <strong className="level-total">{progress.coins}<small> COINS</small></strong>
            </div>
            <div className="level-meter" role="progressbar" aria-label={`Coin progress to level ${level + 1}`} aria-valuemin={0} aria-valuemax={COINS_PER_LEVEL} aria-valuenow={coinsInLevel}>
              <span style={{ width: `${levelPercent}%` }} />
            </div>
            <div className="level-caption"><span>{coinsInLevel} / {COINS_PER_LEVEL} coins</span><span>{coinsToNextLevel} coins to next level</span></div>
            <div className="energy-summary"><span className="energy-emblem"><img className="reward-icon" src="/manus-storage/async-images/HLcXFOjQTDJT7e7kNiY0xW/image-2.webp" alt="" aria-hidden="true" /></span><span><strong>{dailyEnergy}/{DAILY_GOAL} energy today</strong><small>{questCompleted ? "Daily energy fully charged" : "Study words to charge energy"}</small></span></div>
            <small className="storage-note">Progress saved on this device only</small>
          </article>
        </section>

        {studyFeedback && <div className="coin-toast" role="status"><img className="reward-icon" src="/manus-storage/async-images/OEJzGdgxpnNeQxfkLg6Ga0/image-1.webp" alt="" aria-hidden="true" /> {studyFeedback}</div>}

        <section className="workbench" id="practice" aria-labelledby="workbench-title">
          <div className="workbench-head">
            <div><span className="section-index">01 <span>—</span> YOUR SOURCE</span><h2 id="workbench-title">Open your image library</h2></div>
            <div className="drive-pill"><FolderOpen size={15} /> GOOGLE DRIVE</div>
          </div>
          <div className="source-form">
            <label htmlFor="drive-folder">Folder link</label>
            <div className="source-controls">
              <div className="input-wrap"><FolderOpen size={18} /><input id="drive-folder" value={folder} onChange={(event) => setFolder(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void pickRandomImage(); }} placeholder="Paste your Google Drive folder link" autoComplete="url" /></div>
              <button className="primary-button" type="button" onClick={() => void pickRandomImage()} disabled={busy || !folder.trim()}>
                {busy ? <><LoaderCircle size={17} className="spin" /> Scanning…</> : <><Sparkles size={16} /> Pick a random image <ArrowRight size={16} /></>}
              </button>
            </div>
            <div className="source-help"><span>Public folder: “Anyone with the link — Viewer”.</span><span>JPG · PNG · GIF · TIFF · BMP · WEBP <i>•</i> Gemini 3.5 Flash-Lite</span></div>
            <p className="source-note">No Drive API key needed for public folders. If Gemini 3.5 reaches its rate/quota limit, Wordpick tries Gemini 3.1 Flash-Lite. English phrases stay together; private folders aren’t supported yet.</p>
            {error && <div className="error-banner" role="alert"><TriangleAlert size={17} /><span>{error}</span></div>}
          </div>
        </section>

        <section className="results-section" id="results" aria-live="polite">
          <div className="results-heading"><div><span className="section-index">02 <span>—</span> YOUR STUDY ROUND</span><h2>Words in the wild</h2></div>{result && <button className="text-button" onClick={() => void pickRandomImage()} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} /> Another image</button>}</div>
          {result && <p className={`cache-status ${result.cacheStatus}`} role="status">{result.cacheStatus === "hit" ? "Đã tải từ bộ nhớ chung; không cần OCR lại." : result.cacheStatus === "saved" ? "Đã lưu vào bộ nhớ chung cho lần sau và những người dùng khác." : "OCR đã xong nhưng Supabase chưa sẵn sàng; lần sau có thể cần quét lại."}</p>}
          {result ? (
            <div className="result-grid">
              <article className="image-panel">
                <div className="panel-topline"><span><FileImage size={15} /> SOURCE IMAGE</span><span className="image-counter">01 / 01</span></div>
                <div className="photo-frame"><img src={result.image.dataUrl} alt={`Ảnh được chọn ngẫu nhiên: ${result.image.name}`} /></div>
                <div className="image-caption"><span className="caption-dot" /><span>{result.image.name}</span></div>
              </article>
              <article className="text-panel">
                <div className="panel-topline"><span><ScanLine size={15} /> ENGLISH VOCABULARY</span><span className="ready-tag"><Check size={13} /> READY TO STUDY</span></div>
                <p className="study-hint">Tap a word or phrase after studying it to earn coins.</p>
                <div className="recognized-copy">
                  <div className="vocabulary-list" aria-label="English vocabulary">
                    {vocabulary.map((word, index) => {
                      const studied = hasStudiedToday(progress, word, today);
                      return (
                        <div className={`vocabulary-card${studied ? " word-studied" : ""}`} key={`${word.toLowerCase()}-${index}`}>
                          <span className="vocabulary-word">{word}</span>
                          <button className="word-study-button" type="button" onClick={() => markWordStudied(word)} disabled={studied} aria-label={studied ? `${word}, studied today` : `Mark ${word} as studied and earn ${COINS_PER_STUDY} coins`}>
                            {studied ? <><Check size={14} /> Done</> : <><img className="reward-icon" src="/manus-storage/async-images/OEJzGdgxpnNeQxfkLg6Ga0/image-1.webp" alt="" aria-hidden="true" /> +{COINS_PER_STUDY}</>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="text-panel-footer"><span>{result.modelUsed === "gemini-3.1-flash-lite" ? "Gemini 3.1 Flash-Lite fallback" : "Gemini 3.5 Flash-Lite"} · Phrases stay together · no IPA</span><button className="copy-button" onClick={() => void copyText()}><Clipboard size={15} /> {copied ? "Copied" : "Copy list"}</button></div>
              </article>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-art"><div className="empty-photo"><span className="photo-sun" /><span className="photo-hill photo-hill-one" /><span className="photo-hill photo-hill-two" /><span className="photo-scribble">hello!</span></div><span className="empty-spark empty-spark-one">✳</span><span className="empty-spark empty-spark-two">✳</span><span className="empty-arrow"><ArrowDownRight size={23} /></span></div>
              <div className="empty-copy"><span className="empty-kicker">YOUR NEXT LESSON IS HIDING IN PLAIN SIGHT</span><p>Paste your Drive folder link above.<br /><b>We’ll find words and phrases in one of its images.</b></p></div>
              <div className="empty-step"><span>01</span><span>ADD A FOLDER</span><i /><span>02</span><span>DISCOVER WORDS</span></div>
            </div>
          )}
        </section>

        <section className="how-section" id="how-it-works">
          <div className="how-title"><span className="section-index">A SMALL STUDY RITUAL</span><h2>Three steps.<br /><em>One new perspective.</em></h2></div>
          <div className="how-steps">
            <div className="how-step"><span className="step-no">01</span><FolderOpen size={19} /><h3>Point to a folder</h3><p>Choose an image folder you can view in Google Drive.</p></div>
            <div className="how-step"><span className="step-no">02</span><Sparkles size={19} /><h3>Meet a new image</h3><p>Wordpick picks one picture at random and finds its English words and phrases.</p></div>
            <div className="how-step"><span className="step-no">03</span><BookOpen size={19} /><h3>Make it yours</h3><p>Read, copy, and turn the words and phrases you find into your next lesson.</p></div>
          </div>
        </section>

        <footer className="footer"><a className="brand brand-small" href="#home"><span className="brand-mark"><span>W</span><i /></span><span className="brand-name">wordpick<span>.</span></span></a><span>MADE FOR CURIOUS MINDS <i>·</i> ENGLISH, ONE IMAGE AT A TIME</span><a className="footer-top" href="#home">Back to top ↑</a></footer>
      </main>

      <nav className="mobile-nav" aria-label="Main navigation">
        <a href="#practice" className={activeTab === "practice" ? "mobile-tab is-active" : "mobile-tab"} aria-current={activeTab === "practice" ? "page" : undefined} onClick={() => setActiveTab("practice")}>
          <span className="mobile-tab-icon"><BookOpen size={18} aria-hidden="true" /></span>
          <span className="mobile-tab-label">Practice</span>
        </a>
        <a href="#home" className={activeTab === "home" ? "mobile-tab is-active" : "mobile-tab"} aria-current={activeTab === "home" ? "page" : undefined} onClick={() => setActiveTab("home")}>
          <span className="mobile-tab-icon"><House size={18} aria-hidden="true" /></span>
          <span className="mobile-tab-label">Home</span>
        </a>
        <a href="#progress" className={activeTab === "progress" ? "mobile-tab is-active" : "mobile-tab"} aria-current={activeTab === "progress" ? "page" : undefined} onClick={() => setActiveTab("progress")}>
          <span className="mobile-tab-icon"><Trophy size={18} aria-hidden="true" /><span className="mobile-tab-level" aria-hidden="true">{level > 99 ? "99+" : level}</span></span>
          <span className="mobile-tab-label">Progress</span>
        </a>
      </nav>
    </div>
  );
}

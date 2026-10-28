import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { findOcrCache, saveOcrCache } from "./supabaseOcrCache";

const GEMINI_PRIMARY_MODEL = "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const GEMINI_PRIMARY_CACHE_MODEL = `${GEMINI_PRIMARY_MODEL}-vocab-v2`;
const GEMINI_FALLBACK_CACHE_MODEL = `${GEMINI_FALLBACK_MODEL}-vocab-v2`;
const GEMINI_CACHE_MODELS = [GEMINI_PRIMARY_CACHE_MODEL, GEMINI_FALLBACK_CACHE_MODEL] as const;
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_IMAGE_LIMIT = 8_000_000;
const IPA_SYMBOLS = /[\u0250-\u02ff\u1d00-\u1dff\u00e6\u00e7\u00f0\u014b\u0153\u021d\u0223\u0231\u0233]/iu;
const IPA_LABEL_PATTERN = /\bI[.\s]*P[.\s]*A\b\.?[ \t]*(?::|=)?[ \t]*(?:\/[^/\r\n]{1,80}\/|\[[^\]\r\n]{1,80}\]|\([^)\r\n]{1,80}\))?/gi;
const SLASH_DELIMITED_PATTERN = /\/[^/\r\n]{1,80}\//g;
const BRACKETED_PATTERN = /(?:\[[^\]\r\n]{1,80}\]|\([^)\r\n]{1,80}\))/gu;
const IPA_MARKED_TOKEN_PATTERN = /[A-Za-z]*[\u0250-\u02ff\u1d00-\u1dff\u00e6\u00e7\u00f0\u014b\u0153\u021d\u0223\u0231\u0233][A-Za-z]*/giu;
const MAX_FOLDER_HTML_BYTES = 12_000_000;
const FOLDER_LIST_CACHE_TTL_MS = 5 * 60_000;
const FOLDER_LIST_CACHE_MAX_ENTRIES = 20;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|gif|bmp|tiff?|webp)$/i;

export class PublicOcrError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "PublicOcrError";
  }
}

type DriveImage = { id: string; name: string };
type DownloadedImage = { bytes: Buffer };
type GeminiImageMimeType = "image/jpeg" | "image/png" | "image/webp";
type PreparedGeminiImage = { bytes: Buffer; mimeType: GeminiImageMimeType };
type FolderListCacheEntry = { images: DriveImage[]; expiresAt: number };
type FolderListSource = "hit" | "miss" | "coalesced";
type FolderListResult = { images: DriveImage[]; source: FolderListSource };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
};
type GeminiRecognition = { text: string; model: string; cacheModel: string; fallbackUsed: boolean };

function extractFolderId(input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new PublicOcrError("Dán link hoặc ID thư mục Google Drive trước nhé.");
  }

  const value = input.trim();
  const embeddedMatch = value.match(/drive\.google\.com\/embeddedfolderview\?id=([a-zA-Z0-9_-]+)/);
  const standardMatch = value.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
  const folderId = embeddedMatch?.[1] ?? standardMatch?.[1] ?? value;

  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(folderId)) {
    throw new PublicOcrError("Link thư mục Google Drive chưa đúng định dạng.");
  }

  return folderId;
}

function geminiKey(): string {
  const key = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!key) {
    throw new PublicOcrError("Website chưa được cấu hình Google AI Studio.", 503);
  }
  return key;
}

function driveImageUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
}

const folderListCache = new Map<string, FolderListCacheEntry>();
const folderListInFlight = new Map<string, Promise<DriveImage[]>>();

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .trim();
}

async function fetchPublicFolderImages(folderId: string): Promise<DriveImage[]> {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new PublicOcrError("Google Drive tạm thời không phản hồi. Thử lại sau nhé.", 502);
  }

  if (!response.ok) {
    throw new PublicOcrError("Không mở được folder. Hãy kiểm tra lại link chia sẻ công khai.", 403);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_FOLDER_HTML_BYTES) {
    throw new PublicOcrError("Folder Drive quá lớn để quét danh sách ảnh an toàn.", 413);
  }

  const page = await response.text();
  if (Buffer.byteLength(page, "utf8") > MAX_FOLDER_HTML_BYTES) {
    throw new PublicOcrError("Folder Drive quá lớn để quét danh sách ảnh an toàn.", 413);
  }

  const images = new Map<string, DriveImage>();
  const anchorPattern = /<a\b[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of page.matchAll(anchorPattern)) {
    const href = match[1] ?? match[2] ?? "";
    const fileMatch = href.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/view/);
    if (!fileMatch) continue;

    const name = decodeHtml(match[3] ?? "");
    if (!IMAGE_EXTENSIONS.test(name)) continue;
    images.set(fileMatch[1], { id: fileMatch[1], name });
  }

  const entries = [...images.values()];
  if (entries.length === 0) {
    throw new PublicOcrError(
      "Không thấy ảnh trong folder công khai. Google Drive có thể đã đổi trang chia sẻ hoặc folder chưa bật Anyone with the link – Viewer.",
      404,
    );
  }
  return entries;
}

async function listPublicFolderImages(folderId: string): Promise<FolderListResult> {
  const now = Date.now();
  const cached = folderListCache.get(folderId);
  if (cached && cached.expiresAt > now) {
    folderListCache.delete(folderId);
    folderListCache.set(folderId, cached);
    return { images: cached.images, source: "hit" };
  }
  if (cached) folderListCache.delete(folderId);

  const inFlight = folderListInFlight.get(folderId);
  if (inFlight) return { images: await inFlight, source: "coalesced" };

  const load = fetchPublicFolderImages(folderId);
  folderListInFlight.set(folderId, load);
  try {
    const images = await load;
    folderListCache.set(folderId, {
      images,
      expiresAt: Date.now() + FOLDER_LIST_CACHE_TTL_MS,
    });
    while (folderListCache.size > FOLDER_LIST_CACHE_MAX_ENTRIES) {
      const oldestFolderId = folderListCache.keys().next().value;
      if (oldestFolderId === undefined) break;
      folderListCache.delete(oldestFolderId);
    }
    return { images, source: "miss" };
  } finally {
    if (folderListInFlight.get(folderId) === load) folderListInFlight.delete(folderId);
  }
}

async function downloadPublicImage(file: DriveImage): Promise<DownloadedImage> {
  const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file.id)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PublicOcrError("Không tải được ảnh từ Drive. Thử chọn ảnh khác nhé.", 502);
  }

  if (!response.ok) {
    throw new PublicOcrError("Ảnh không cho phép xem công khai. Kiểm tra quyền chia sẻ của file.", 403);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new PublicOcrError("Drive không trả về file ảnh công khai. Kiểm tra quyền chia sẻ của ảnh.", 403);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 30_000_000) {
    throw new PublicOcrError("Ảnh quá lớn để xử lý. Hãy dùng ảnh nhỏ hơn.", 413);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new PublicOcrError("Ảnh trong Drive không có dữ liệu.", 422);
  }
  if (bytes.length > 30_000_000) {
    throw new PublicOcrError("Ảnh quá lớn để xử lý. Hãy dùng ảnh nhỏ hơn.", 413);
  }
  return { bytes };
}

function detectGeminiImageMime(bytes: Buffer): GeminiImageMimeType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function prepareImageForGemini(source: DownloadedImage): Promise<PreparedGeminiImage> {
  if (source.bytes.length <= GEMINI_IMAGE_LIMIT) {
    const detectedMimeType = detectGeminiImageMime(source.bytes);
    if (detectedMimeType) {
      try {
        const metadata = await sharp(source.bytes, { limitInputPixels: 40_000_000 }).metadata();
        if (metadata.orientation === undefined || metadata.orientation === 1) {
          return { bytes: source.bytes, mimeType: detectedMimeType };
        }
      } catch {
        // Fall through to the normal Sharp path, which reports invalid image data.
      }
    }
  }

  try {
    for (const quality of [86, 78, 70, 62, 54]) {
      const jpeg = await sharp(source.bytes, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (jpeg.length <= GEMINI_IMAGE_LIMIT) return { bytes: jpeg, mimeType: "image/jpeg" };
    }
  } catch {
    throw new PublicOcrError("File này không phải ảnh hợp lệ hoặc ảnh bị lỗi.", 422);
  }
  throw new PublicOcrError("Ảnh quá lớn để gửi tới Gemini. Hãy dùng ảnh nhỏ hơn.", 413);
}

class GeminiQuotaError extends Error {
  constructor() {
    super("Gemini quota exceeded");
    this.name = "GeminiQuotaError";
  }
}

async function callGeminiModel(model: string, image: PreparedGeminiImage): Promise<string> {
  const key = geminiKey();
  const prompt = [
    "Read the image and return only distinct English vocabulary words or phrases that are clearly visible.",
    "If a vocabulary item is a multi-word phrase, keep the complete phrase together as one item; never split it into separate words or entries.",
    "Exclude IPA and pronunciation guides, translations, definitions, example sentences, headings, labels, numbers, and non-English words.",
    "Do not guess or add items that are not visible. Preserve the spelling and first-appearance order.",
    "Return plain text with exactly one vocabulary item per line, no bullets or explanations. If no English vocabulary item is visible, return exactly NO_VOCABULARY.",
  ].join(" ");
  const requestBody = {
    contents: [{ role: "user", parts: [
      { text: prompt },
      { inlineData: { mimeType: image.mimeType, data: image.bytes.toString("base64") } },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 },
  };
  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new PublicOcrError("Google Gemini tạm thời không phản hồi. Thử lại sau nhé.", 502);
  }

  if (response.status === 429) {
    throw new GeminiQuotaError();
  }
  if (response.status === 401 || response.status === 403) {
    throw new PublicOcrError("Gemini API key chưa hợp lệ hoặc chưa được cấp quyền.", 502);
  }
  if (response.status === 402) {
    throw new PublicOcrError("Tài khoản Gemini đã hết credit thanh toán; đổi model không khắc phục được lỗi này.", 402);
  }
  if (response.status === 404) {
    throw new PublicOcrError("Không tìm thấy model Gemini hoặc model chưa khả dụng cho project.", 502);
  }
  if (!response.ok) {
    throw new PublicOcrError("Gemini chưa xử lý được ảnh này. Thử lại sau nhé.", 502);
  }

  let result: GeminiResponse;
  try {
    result = (await response.json()) as GeminiResponse;
  } catch {
    throw new PublicOcrError("Gemini trả về phản hồi không hợp lệ. Thử lại sau nhé.", 502);
  }

  if (result.promptFeedback?.blockReason) {
    throw new PublicOcrError("Gemini không thể xử lý nội dung ảnh này.", 422);
  }
  const text = result.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "").join("\n").trim();
  if (!text) throw new PublicOcrError("Gemini không tìm thấy từ vựng trong ảnh này.", 422);
  return text;
}

async function recognizeWithGemini(
  image: PreparedGeminiImage,
  timings: Record<string, number | string>,
): Promise<GeminiRecognition> {
  try {
    const text = await measure(timings, "gemini_primary_ms", () => callGeminiModel(GEMINI_PRIMARY_MODEL, image));
    return { text, model: GEMINI_PRIMARY_MODEL, cacheModel: GEMINI_PRIMARY_CACHE_MODEL, fallbackUsed: false };
  } catch (error) {
    if (!(error instanceof GeminiQuotaError)) throw error;
    timings.gemini_fallback_reason = "primary_429_resource_exhausted";
    try {
      const text = await measure(timings, "gemini_fallback_ms", () => callGeminiModel(GEMINI_FALLBACK_MODEL, image));
      return { text, model: GEMINI_FALLBACK_MODEL, cacheModel: GEMINI_FALLBACK_CACHE_MODEL, fallbackUsed: true };
    } catch (fallbackError) {
      if (fallbackError instanceof GeminiQuotaError) {
        throw new PublicOcrError("Gemini 3.5 và Gemini 3.1 đều đang chạm giới hạn quota. Thử lại sau nhé.", 429);
      }
      throw fallbackError;
    }
  }
}

export function extractEnglishVocabulary(ocrText: string): string[] {
  if (/^\s*NO_VOCABULARY\s*$/i.test(ocrText)) return [];
  const withoutIpa = ocrText
    .replace(SLASH_DELIMITED_PATTERN, (segment) => (IPA_SYMBOLS.test(segment) ? " " : segment))
    .replace(BRACKETED_PATTERN, (segment) => (IPA_SYMBOLS.test(segment) || /\bI[.\s]*P[.\s]*A\b/i.test(segment) ? " " : segment))
    .replace(IPA_LABEL_PATTERN, " ")
    .replace(IPA_MARKED_TOKEN_PATTERN, " ");
  const entries = withoutIpa.split(/\r?\n/u);
  const seen = new Set<string>();
  const vocabulary: string[] = [];

  for (const rawEntry of entries) {
    const entry = rawEntry
      .replace(/^\s*(?:[-*•]+\s*|\d+[.)]\s*)/u, "")
      .replace(/^\s*(?:(?:english\s+)?(?:vocabulary|words?|phrases?))\s*:\s*/i, "")
      .replace(/^[\s"'`“‘]+|[\s"'`”’]+$/gu, "")
      .trim();
    const tokens = entry.match(/(?<![\p{L}\p{N}])[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*(?![\p{L}\p{N}])/gu) ?? [];
    if (tokens.length === 0) continue;
    const item = tokens.join(" ");
    const normalized = item.toLowerCase();
    if (normalized === "ipa" || seen.has(normalized)) continue;
    seen.add(normalized);
    vocabulary.push(item);
  }

  return vocabulary;
}

async function measure<T>(timings: Record<string, number | string>, key: string, task: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    timings[key] = Math.round((performance.now() - startedAt) * 10) / 10;
  }
}

export async function runRandomDriveOcr(folderInput: unknown) {
  const startedAt = performance.now();
  const timings: Record<string, number | string> = {};
  let outcome = "error";

  try {
    const folderId = extractFolderId(folderInput);
    const folderList = await measure(timings, "folder_listing_ms", () => listPublicFolderImages(folderId));
    timings.folder_list_cache = folderList.source;
    const selectedImage = folderList.images[Math.floor(Math.random() * folderList.images.length)];
    const imageUrl = driveImageUrl(selectedImage.id);
    const cached = await measure(timings, "supabase_lookup_ms", () => findOcrCache(selectedImage.id, GEMINI_CACHE_MODELS));
    timings.ocr_cache = cached.status;

    if (cached.status === "hit") {
      const cachedImage = await measure(timings, "cache_image_download_ms", () => downloadPublicImage(selectedImage));
      const preparedCachedImage = await measure(timings, "image_prepare_ms", () => prepareImageForGemini(cachedImage));
      const modelUsed = cached.record.model.replace(/-vocab-v\d+$/, "");
      timings.gemini_model_used = modelUsed;
      outcome = "cache_hit";
      return {
        image: {
          name: cached.record.file_name || selectedImage.name,
          mimeType: preparedCachedImage.mimeType,
          dataUrl: `data:${preparedCachedImage.mimeType};base64,${preparedCachedImage.bytes.toString("base64")}`,
        },
        text: cached.record.ocr_text,
        cacheStatus: "hit" as const,
        modelUsed,
      };
    }

    const downloadedImage = await measure(timings, "drive_download_ms", () => downloadPublicImage(selectedImage));
    const preparedImage = await measure(timings, "image_prepare_ms", () => prepareImageForGemini(downloadedImage));
    timings.ocr_provider = "gemini";
    const recognition = await measure(timings, "gemini_total_ms", () => recognizeWithGemini(preparedImage, timings));
    timings.gemini_model_used = recognition.model;
    timings.gemini_fallback_used = recognition.fallbackUsed ? "yes" : "no";
    const vocabulary = extractEnglishVocabulary(recognition.text);
    if (vocabulary.length === 0) {
      throw new PublicOcrError("Không tìm thấy từ vựng tiếng Anh trong ảnh này.", 422);
    }
    const text = vocabulary.join("\n");
    const cacheSaved = await measure(timings, "supabase_save_ms", () => saveOcrCache({
      drive_file_id: selectedImage.id,
      folder_id: folderId,
      file_name: selectedImage.name,
      image_url: imageUrl,
      ocr_text: text,
      model: recognition.cacheModel,
    }));

    outcome = cacheSaved ? "ocr_saved" : "ocr_cache_unavailable";
    return {
      image: {
        name: selectedImage.name,
        mimeType: preparedImage.mimeType,
        dataUrl: `data:${preparedImage.mimeType};base64,${preparedImage.bytes.toString("base64")}`,
      },
      text,
      cacheStatus: cacheSaved ? ("saved" as const) : ("unavailable" as const),
      modelUsed: recognition.model,
    };
  } finally {
    timings.total_ms = Math.round((performance.now() - startedAt) * 10) / 10;
    timings.outcome = outcome;
    console.info("[OCR_TIMING]", JSON.stringify(timings));
  }
}

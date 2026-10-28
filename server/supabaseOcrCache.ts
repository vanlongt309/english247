import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type OcrCacheRecord = {
  file_name: string;
  image_url: string;
  ocr_text: string;
  model: string;
};

export type OcrCacheLookup =
  | { status: "hit"; record: OcrCacheRecord }
  | { status: "miss" | "unavailable" };

type OcrCacheWrite = {
  drive_file_id: string;
  folder_id: string;
  file_name: string;
  image_url: string;
  ocr_text: string;
  model: string;
};

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !secretKey) return null;
  if (client) return client;

  const projectUrl = rawUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  try {
    client = createClient(projectUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    return client;
  } catch {
    console.warn("[OCR_CACHE] Supabase client configuration is invalid.");
    return null;
  }
}

function logCacheFailure(operation: string, code?: string) {
  const safeCode = code && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
  console.warn(`[OCR_CACHE] ${operation} failed (${safeCode}).`);
}

export async function findOcrCache(driveFileId: string, expectedModels: readonly string[]): Promise<OcrCacheLookup> {
  const supabase = getClient();
  if (!supabase) return { status: "unavailable" };

  try {
    const { data, error } = await supabase
      .from("ocr_cache")
      .select("file_name,image_url,ocr_text,model")
      .eq("drive_file_id", driveFileId)
      .maybeSingle();

    if (error) {
      logCacheFailure("lookup", error.code);
      return { status: "unavailable" };
    }
    if (!data || !expectedModels.includes(data.model)) return { status: "miss" };
    return { status: "hit", record: data as OcrCacheRecord };
  } catch {
    logCacheFailure("lookup");
    return { status: "unavailable" };
  }
}

export async function saveOcrCache(record: OcrCacheWrite): Promise<boolean> {
  const supabase = getClient();
  if (!supabase) return false;

  try {
    const { error } = await supabase.from("ocr_cache").upsert(
      { ...record, updated_at: new Date().toISOString() },
      { onConflict: "drive_file_id" },
    );
    if (error) {
      logCacheFailure("upsert", error.code);
      return false;
    }
    return true;
  } catch {
    logCacheFailure("upsert");
    return false;
  }
}

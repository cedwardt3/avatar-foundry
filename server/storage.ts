import { Storage } from "@google-cloud/storage";
import { ENV } from "./env";

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (!_storage) {
    // Uses Application Default Credentials — a downloaded service account
    // key locally (GOOGLE_APPLICATION_CREDENTIALS), or the runtime's
    // implicit identity in production. No explicit key handling here.
    _storage = new Storage({ projectId: ENV.GCP_PROJECT_ID });
  }
  return _storage;
}

function bucket() {
  return getStorage().bucket(ENV.GCS_BUCKET);
}

/**
 * Path convention (keep this consistent — several modules assume it):
 *   characters/{slug}/references/{filename}
 *   characters/{slug}/dataset/{filename}
 *   characters/{slug}/checkpoints/{runId}/lora.safetensors
 *   characters/{slug}/checkpoints/{runId}/logs.txt
 *   characters/{slug}/generations/{generationId}.png
 */
export function buildPath(
  slug: string,
  kind: "references" | "dataset" | "checkpoints" | "generations",
  filename: string
): string {
  return `characters/${slug}/${kind}/${filename}`;
}

export async function uploadBuffer(
  path: string,
  data: Buffer,
  contentType: string
): Promise<string> {
  const file = bucket().file(path);
  await file.save(data, { contentType, resumable: false });
  return `gs://${ENV.GCS_BUCKET}/${path}`;
}

/**
 * Signed URL for direct browser upload — used so large reference/dataset
 * images don't have to round-trip through the Next.js server. The client
 * requests a signed URL from an API route, then PUTs the file directly
 * to GCS.
 */
export async function getSignedUploadUrl(
  path: string,
  contentType: string,
  expiresInMinutes = 15
): Promise<string> {
  const file = bucket().file(path);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType,
  });
  return url;
}

/** Signed URL for reading a private object (e.g. displaying a checkpoint's sample output in the UI). */
export async function getSignedReadUrl(path: string, expiresInMinutes = 60): Promise<string> {
  const file = bucket().file(path);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}

/** Reads and parses a small JSON object from GCS. Returns null if it doesn't exist yet (e.g. job still running). */
export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const [data] = await bucket().file(path).download();
    return JSON.parse(data.toString("utf8")) as T;
  } catch (error: unknown) {
    const err = error as { code?: number };
    if (err.code === 404) return null;
    throw error;
  }
}

/** Reads a small text object (e.g. a caption .txt file). Returns null if it doesn't exist. */
export async function readText(path: string): Promise<string | null> {
  try {
    const [data] = await bucket().file(path).download();
    return data.toString("utf8");
  } catch (error: unknown) {
    const err = error as { code?: number };
    if (err.code === 404) return null;
    throw error;
  }
}

/** Lists object names under a prefix (non-recursive by convention here — our paths are already flat within each kind/). */
export async function listObjects(prefix: string): Promise<string[]> {
  const [files] = await bucket().getFiles({ prefix });
  return files.map((f) => f.name);
}

export async function deleteObject(path: string): Promise<void> {
  await bucket().file(path).delete({ ignoreNotFound: true });
}

export function gcsUriToPath(gcsUri: string): string {
  const prefix = `gs://${ENV.GCS_BUCKET}/`;
  if (!gcsUri.startsWith(prefix)) {
    throw new Error(`URI does not belong to configured bucket: ${gcsUri}`);
  }
  return gcsUri.slice(prefix.length);
}

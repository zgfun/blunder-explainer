/**
 * Bring-your-own-key: a visitor's Anthropic API key arrives in this header on POST /api/explain
 * only. It is used for that one request and never stored, logged or echoed (see docs/byok.md).
 */
export const VISITOR_KEY_HEADER = "x-anthropic-key";
export const MAX_VISITOR_KEY_LENGTH = 300;

/** Every character an Anthropic key can contain. Shared with the browser's own check. */
export const KEY_CHARSET = /^[A-Za-z0-9_-]+$/;

export type VisitorKey = { kind: "none" } | { kind: "malformed" } | { kind: "key"; key: string };

/** An absent or blank header is "none"; anything else must look like a key or it is "malformed". */
export function readVisitorKey(headers: Headers): VisitorKey {
  const raw = headers.get(VISITOR_KEY_HEADER);
  if (raw === null) return { kind: "none" };
  const key = raw.trim();
  if (!key) return { kind: "none" };
  if (key.length > MAX_VISITOR_KEY_LENGTH || !KEY_CHARSET.test(key)) return { kind: "malformed" };
  return { kind: "key", key };
}

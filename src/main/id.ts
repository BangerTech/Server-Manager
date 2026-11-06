import { randomUUID } from 'node:crypto'

/** Short, URL-safe unique id. Uses Node's built-in crypto (no ESM-only deps). */
export function nanoid(): string {
  // 21-char base64url slice keeps ids compact like the original nanoid default.
  return randomUUID().replace(/-/g, '').slice(0, 21)
}

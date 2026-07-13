import { createHash } from 'node:crypto'

/**
 * Normalizes dynamic variables (UUIDs, IPs, timestamps, numbers, strings) out
 * of a review comment body and produces a 16-character SHA-256 fingerprint.
 * 
 * Based on the Superlog fingerprinting architecture, this allows Areté to group
 * repetitive LLM review comments (e.g. the same missing auth check across 15
 * different files) into a single unified incident bucket, reducing PR fatigue.
 */
export function fingerprintComment(body: string, category: string): string {
  let s = body
  s = s.replace(/https?:\/\/\S+/gi, '<url>')
  s = s.replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '<email>')
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
  s = s.replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?(?:[+-]\d{2}:?\d{2})?\b/g, '<ts>')
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<ip>')
  s = s.replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '<str>')
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, '<str>')
  s = s.replace(/\b\d+\b/g, '<n>')
  s = s.replace(/\s+/g, ' ').trim().toLowerCase()
  
  const canonical = `${category}::${s}`
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

import { fingerprintComment } from './src/fingerprint.js'

// Simulate a batch of comments returned by the LLM reviewer.
// Notice how the core issue ("Missing bounds check") is identical, but the
// dynamic variables (URLs, UUIDs, IPs, IDs) differ across each instance.
const mockComments = [
  {
    path: 'api/processor.ts',
    line: 42,
    category: 'Security',
    severity: 'error',
    body: 'Missing bounds check when accessing user buffer ID: 550e8400-e29b-41d4-a716-446655440000. See documentation at https://acme.inc/docs/bounds'
  },
  {
    path: 'api/processor.ts',
    line: 88,
    category: 'Security',
    severity: 'error',
    body: 'Missing bounds check when accessing user buffer ID: 123e4567-e89b-12d3-a456-426614174000. See documentation at https://acme.inc/docs/bounds#v2'
  },
  {
    path: 'api/processor.ts',
    line: 112,
    category: 'Security',
    severity: 'error',
    body: 'Missing bounds check when accessing user buffer ID: abcdef12-3456-7890-abcd-ef1234567890. See documentation at http://internal.wiki/sec'
  },
  // This one is genuinely different (different category and message)
  {
    path: 'api/processor.ts',
    line: 50,
    category: 'Performance',
    severity: 'warning',
    body: 'Unnecessary loop iteration detected. Could cause N+1 query issue.'
  }
]

console.log('--- Areté Fingerprint & Deduplication Simulator ---\\n')
console.log(`Original LLM Comments Count: ${mockComments.length}\\n`)

const seenFingerprints = new Set<string>()

const dedupedComments = mockComments.filter((c) => {
  const hash = fingerprintComment(c.body, c.category)
  const uniqueKey = `${c.path}:${hash}`
  
  console.log(`[Line ${c.line}] Body: "${c.body.substring(0, 60)}..."`)
  console.log(`-> Fingerprint Hash: ${hash}`)
  
  if (seenFingerprints.has(uniqueKey)) {
    console.log(`-> Status: ❌ DROPPED (Duplicate semantic signature detected)\\n`)
    return false
  }
  
  seenFingerprints.add(uniqueKey)
  console.log(`-> Status: ✅ ACCEPTED (First occurrence)\\n`)
  return true
})

console.log('--- Final GitHub Payload ---')
console.log(`Comments posted to GitHub: ${dedupedComments.length}`)
for (const c of dedupedComments) {
  console.log(`- Line ${c.line}: [${c.category}] ${c.body.substring(0, 60)}...`)
}

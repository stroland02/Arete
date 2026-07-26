import { describe, expect, it } from 'vitest'

import { buildLocalPRContext, parseDiff } from './build-context.js'

/**
 * The parser is the fiddly, bug-prone half of the dev-review path. The runner
 * beside it is glue over the real pipeline; this is where the coverage belongs.
 */

const TWO_FILE_DIFF = `diff --git a/src/pay.ts b/src/pay.ts
index 1111111..2222222 100644
--- a/src/pay.ts
+++ b/src/pay.ts
@@ -1,3 +1,4 @@
 export function charge(x) {
-  return x
+  // TODO: validate
+  return x * 100
 }
diff --git a/README.md b/README.md
index 3333333..4444444 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Kuma
+A line.
`

describe('parseDiff', () => {
  it('returns one FileChange per file with the right path and language', () => {
    const files = parseDiff(TWO_FILE_DIFF)
    expect(files.map((f) => f.path)).toEqual(['src/pay.ts', 'README.md'])
    expect(files.map((f) => f.language)).toEqual(['typescript', 'markdown'])
  })

  it('counts body additions and deletions without the +++/--- headers', () => {
    // The header lines start with +++/---; counting them would add one phantom
    // addition and one phantom deletion to every single file.
    const [pay] = parseDiff(TWO_FILE_DIFF)
    expect(pay.additions).toBe(2)
    expect(pay.deletions).toBe(1)
  })

  it('carries the patch body so the specialist sees the actual change', () => {
    const [pay] = parseDiff(TWO_FILE_DIFF)
    expect(pay.patch).toContain('return x * 100')
    expect(pay.patch).not.toMatch(/^diff --git/)
  })

  it('marks an added file added and reads its path from the +++ side', () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const a = 1
+export const b = 2
`
    const [f] = parseDiff(diff)
    expect(f.path).toBe('new.ts')
    expect(f.status).toBe('added')
    expect(f.additions).toBe(2)
  })

  it('marks a deleted file removed and reads its path from the --- side, not /dev/null', () => {
    const diff = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 6666666..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const a = 1
-export const b = 2
`
    const [f] = parseDiff(diff)
    expect(f.path).toBe('gone.ts')
    expect(f.status).toBe('removed')
    expect(f.deletions).toBe(2)
  })

  it('gives an unknown extension an empty language rather than a wrong guess', () => {
    const diff = `diff --git a/data.xyz b/data.xyz
--- a/data.xyz
+++ b/data.xyz
@@ -1 +1 @@
-old
+new
`
    expect(parseDiff(diff)[0].language).toBe('')
  })

  it('is empty for an empty diff', () => {
    expect(parseDiff('')).toEqual([])
    expect(parseDiff('   \n  ')).toEqual([])
  })
})

describe('buildLocalPRContext', () => {
  it('uses pr_number 0 — there is no PR, and a fake number would be fabrication', () => {
    const ctx = buildLocalPRContext(TWO_FILE_DIFF)
    expect(ctx.pr_number).toBe(0)
    expect(ctx.files).toHaveLength(2)
  })

  it('forwards installationId only when given, so BYO-model resolution can run', () => {
    // runReviewPipeline resolves the tenant's model from installationId; absent
    // it, the agents service uses its own default. Both are valid; a fabricated
    // id is not.
    expect(buildLocalPRContext('', {}).installationId).toBeUndefined()
    expect(buildLocalPRContext('', { installationId: 42 }).installationId).toBe(42)
  })

  it('lets the caller name the repo and title but defaults them honestly', () => {
    const def = buildLocalPRContext('')
    expect(def.repo).toBe('local/working-tree')
    expect(def.title).toBe('Local diff review')

    const named = buildLocalPRContext('', { repo: 'acme/api', title: 'auth refactor' })
    expect(named.repo).toBe('acme/api')
    expect(named.title).toBe('auth refactor')
  })
})

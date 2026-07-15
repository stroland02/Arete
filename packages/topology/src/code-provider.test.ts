import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeGraphProvider } from './code-provider.js'

const sample = {
  project: 'install-42',
  generatedAt: '2026-07-15T00:00:00Z',
  nodes: [
    { id: 'f1', kind: 'File', name: 'a.ts', path: 'src/a.ts', qualifiedName: null, degree: 2, untested: false, dead: false },
    { id: 'fn1', kind: 'Function', name: 'doThing', path: 'src/a.ts', qualifiedName: 'a.doThing', degree: 1, untested: true, dead: false },
  ],
  edges: [{ source: 'f1', target: 'fn1', kind: 'DEFINES' }],
}

test('maps code nodes into Topology nodes with code provenance + meta', () => {
  const t = codeGraphProvider(sample)
  assert.equal(t.nodes.length, 2)
  const fn = t.nodes.find((n) => n.id === 'fn1')!
  assert.equal(fn.kind, 'Function')
  assert.equal(fn.label, 'doThing')
  assert.equal(fn.provider, 'code')
  assert.equal(fn.status, 'unknown')
  assert.equal(fn.meta?.path, 'src/a.ts')
  assert.equal(fn.meta?.untested, true)
  assert.equal(fn.meta?.dead, false)
})

test('maps edges onto from/to with code source provenance', () => {
  const t = codeGraphProvider(sample)
  assert.equal(t.edges.length, 1)
  const e = t.edges[0]
  assert.equal(e.from, 'f1')
  assert.equal(e.to, 'fn1')
  assert.equal(e.kind, 'DEFINES')
  assert.equal(e.source, 'code')
})

test('drops edges whose endpoints are not both present', () => {
  const t = codeGraphProvider({
    project: 'install-0',
    generatedAt: '',
    nodes: [{ id: 'f1', kind: 'File', name: 'a.ts' }],
    edges: [{ source: 'f1', target: 'missing', kind: 'CALLS' }],
  })
  assert.equal(t.edges.length, 0)
})

test('is a pure function of its input (no throw on empty)', () => {
  const t = codeGraphProvider({ project: 'install-0', generatedAt: '', nodes: [], edges: [] })
  assert.equal(t.nodes.length, 0)
  assert.equal(t.edges.length, 0)
  assert.deepEqual(t.groups, [])
})

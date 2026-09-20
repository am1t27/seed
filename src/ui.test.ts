import { describe, it, expect } from 'vitest'
import { withoutWord } from './ui'

describe('withoutWord', () => {
  it('drops the word, so a refresh starts over from the default', () => {
    expect(withoutWord('https://seedaword.vercel.app/?w=ocean')).toBe('https://seedaword.vercel.app/')
  })

  it('keeps every other parameter', () => {
    expect(withoutWord('http://localhost:5173/?w=ocean&tier=3&freeze')).toBe(
      'http://localhost:5173/?tier=3&freeze',
    )
  })

  it('leaves an address with no word alone', () => {
    expect(withoutWord('https://seedaword.vercel.app/')).toBe('https://seedaword.vercel.app/')
  })
})

import { describe, expect, it } from 'vitest'

import { formatCash, formatClock } from '../src/ui/format'

describe('formatting', () => {
  it('formats a round clock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(61_000)).toBe('1:01')
    expect(formatClock(239_001)).toBe('4:00')
    expect(formatClock(-5)).toBe('0:00')
  })
  it('formats cash with K and M', () => {
    expect(formatCash(300)).toBe('$300')
    expect(formatCash(9_999)).toBe('$9,999')
    expect(formatCash(12_500)).toBe('$12.5K')
    expect(formatCash(250_000)).toBe('$250K')
    expect(formatCash(1_500_000)).toBe('$1.5M')
  })
})

import { describe, expect, it } from 'vitest'
import { constraintValue, createFreeCurve, deformFreeCurve, type FunctionItem } from './curveEngine'

const item: FunctionItem = {
  id: 'f',
  name: 'f',
  expression: 'x^2 - 2',
  color: '#000',
  transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 },
  anchors: [{ id: 'a', x: 1, y: 2 }],
  freeCurve: null,
  freeAnchors: [],
}

describe('curve engine', () => {
  it('keeps a mathematical constraint point attached to the function', () => {
    expect(constraintValue(item, 1)).toBeCloseTo(2, 8)
  })

  it('spreads a point constraint across a broad smooth base', () => {
    const originalAtThree = 3 ** 2 - 2
    expect(Math.abs(constraintValue(item, 3) - originalAtThree)).toBeGreaterThan(0.1)
    expect(constraintValue(item, 4.7)).toBeCloseTo(4.7 ** 2 - 2, 8)
  })

  it('moves an elastic string in one direction without reverse bends', () => {
    const curve = createFreeCurve({ ...item, anchors: [] })
    const grabbed = Math.floor(curve.length / 2)
    const deformed = deformFreeCurve(curve, grabbed, 1, 2)
    const offsets = deformed.map((point, index) => ({ x: point.x - curve[index].x, y: point.y - curve[index].y }))

    expect(offsets[grabbed]).toEqual({ x: 1, y: 2 })
    expect(offsets.every((offset) => offset.x >= 0 && offset.y >= 0)).toBe(true)
    for (let index = grabbed - 89; index < grabbed; index += 1) {
      expect(offsets[index + 1].y).toBeGreaterThanOrEqual(offsets[index].y)
    }
    for (let index = grabbed; index < grabbed + 89; index += 1) {
      expect(offsets[index + 1].y).toBeLessThanOrEqual(offsets[index].y)
    }
    expect(offsets[grabbed - 90]).toEqual({ x: 0, y: 0 })
    expect(offsets[grabbed + 90]).toEqual({ x: 0, y: 0 })
  })

  it.each([-8, 8])('keeps a large drag local instead of moving the whole string for %s', (dx) => {
    const curve = createFreeCurve({ ...item, anchors: [] })
    const grabbed = Math.floor(curve.length / 2)
    const deformed = deformFreeCurve(curve, grabbed, dx, -3)
    expect(deformed[grabbed].x - curve[grabbed].x).toBeCloseTo(dx, 10)
    expect(deformed[grabbed].y - curve[grabbed].y).toBeCloseTo(-3, 10)
    const displacements = deformed.map((point, index) => Math.hypot(point.x - curve[index].x, point.y - curve[index].y))
    for (let index = grabbed - 64; index < grabbed; index += 1) expect(displacements[index + 1]).toBeGreaterThanOrEqual(displacements[index])
    for (let index = grabbed; index < grabbed + 64; index += 1) expect(displacements[index + 1]).toBeLessThanOrEqual(displacements[index])
    expect(displacements[grabbed - 90]).toBe(0)
    expect(displacements[grabbed + 90]).toBe(0)
  })

  it('uses the previously deformed string as the next drag source and preserves pins', () => {
    const original = createFreeCurve({ ...item, anchors: [] })
    const firstIndex = Math.floor(original.length / 2)
    const first = deformFreeCurve(original, firstIndex, 0.5, 2)
    const secondIndex = firstIndex + 45
    const second = deformFreeCurve(first, secondIndex, -0.25, 1, [firstIndex])
    expect(second[firstIndex]).toEqual(first[firstIndex])
    expect(second[secondIndex].y).toBeGreaterThan(first[secondIndex].y)
    expect(second[secondIndex].y).toBeGreaterThan(original[secondIndex].y)
  })
})

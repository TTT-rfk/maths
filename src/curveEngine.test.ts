import { describe, expect, it } from 'vitest'
import { createFreeCurve, deformConstraintCurve, deformFreeCurve, sampleCurve, type FunctionItem } from './curveEngine'

const item: FunctionItem = {
  id: 'f',
  name: 'f',
  expression: 'x^2 - 2',
  color: '#000',
  transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 },
  freeCurve: null,
  freeAnchors: [],
}

describe('curve engine', () => {
  it('spreads a mathematical point drag across a broad smooth base', () => {
    const curve = createFreeCurve(item)
    const grabbed = curve.findIndex((point) => point.x >= 1)
    const deformed = deformConstraintCurve(curve, grabbed, 3)
    expect(deformed[grabbed].y - curve[grabbed].y).toBeCloseTo(3, 8)
    const withinBase = deformed.findIndex((point) => point.x >= 3)
    const outsideBase = deformed.findIndex((point) => point.x >= 4.7)
    expect(Math.abs(deformed[withinBase].y - curve[withinBase].y)).toBeGreaterThan(0.1)
    expect(deformed[outsideBase].y).toBe(curve[outsideBase].y)
  })

  it('moves an elastic string in one direction without reverse bends', () => {
    const curve = createFreeCurve(item)
    const grabbed = Math.floor(curve.length / 2)
    const deformed = deformFreeCurve(curve, grabbed, 2)
    const offsets = deformed.map((point, index) => ({ x: point.x - curve[index].x, y: point.y - curve[index].y }))

    expect(offsets[grabbed]).toEqual({ x: 0, y: 2 })
    expect(offsets.every((offset) => offset.x === 0 && offset.y >= 0)).toBe(true)
    for (let index = grabbed - 51; index < grabbed; index += 1) {
      expect(offsets[index + 1].y).toBeGreaterThanOrEqual(offsets[index].y)
    }
    for (let index = grabbed; index < grabbed + 51; index += 1) {
      expect(offsets[index + 1].y).toBeLessThanOrEqual(offsets[index].y)
    }
    expect(offsets[grabbed - 52]).toEqual({ x: 0, y: 0 })
    expect(offsets[grabbed + 52]).toEqual({ x: 0, y: 0 })
  })

  it('keeps the rope-mode hill narrower than the mathematical constraint hill', () => {
    const curve = createFreeCurve(item)
    const grabbed = Math.floor(curve.length / 2)
    const mathematical = deformConstraintCurve(curve, grabbed, 2)
    const rope = deformFreeCurve(curve, grabbed, 2)
    const affectedWidth = (result: typeof curve) => result.filter((point, index) => Math.abs(point.y - curve[index].y) > 0.01).length
    expect(affectedWidth(rope)).toBeLessThan(affectedWidth(mathematical))
  })

  it.each([-8, 8])('keeps a large vertical drag local instead of moving the whole string for %s', (dy) => {
    const curve = createFreeCurve(item)
    const grabbed = Math.floor(curve.length / 2)
    const deformed = deformFreeCurve(curve, grabbed, dy)
    expect(deformed[grabbed].x).toBe(curve[grabbed].x)
    expect(deformed[grabbed].y - curve[grabbed].y).toBeCloseTo(dy, 10)
    const displacements = deformed.map((point, index) => Math.hypot(point.x - curve[index].x, point.y - curve[index].y))
    for (let index = grabbed - 64; index < grabbed; index += 1) expect(displacements[index + 1]).toBeGreaterThanOrEqual(displacements[index])
    for (let index = grabbed; index < grabbed + 64; index += 1) expect(displacements[index + 1]).toBeLessThanOrEqual(displacements[index])
    expect(displacements[grabbed - 52]).toBe(0)
    expect(displacements[grabbed + 52]).toBe(0)
  })

  it('uses the previously deformed string as the next drag source and preserves pins', () => {
    const original = createFreeCurve(item)
    const firstIndex = Math.floor(original.length / 2)
    const first = deformFreeCurve(original, firstIndex, 2)
    const secondIndex = firstIndex + 45
    const second = deformFreeCurve(first, secondIndex, 1, [firstIndex])
    expect(second[firstIndex]).toEqual(first[firstIndex])
    expect(second[secondIndex].y).toBeGreaterThan(first[secondIndex].y)
    expect(second[secondIndex].y).toBeGreaterThan(original[secondIndex].y)
  })

  it('samples values and point derivatives from the current deformed curve', () => {
    const curve = createFreeCurve(item)
    const grabbed = curve.findIndex((point) => point.x >= 1)
    const deformed = deformFreeCurve(curve, grabbed, 2)
    const sample = sampleCurve(deformed, deformed[grabbed].x)
    expect(sample?.y).toBeCloseTo(deformed[grabbed].y, 8)
    expect(sample?.derivative).toBeTypeOf('number')
  })

  it('uses a centered local derivative on the sampled curve', () => {
    const curve = createFreeCurve(item)
    expect(sampleCurve(curve, 1)?.derivative).toBeCloseTo(2, 1)
  })

  it('keeps mathematical deformation continuous around pinned points', () => {
    const curve = createFreeCurve(item)
    const grabbed = Math.floor(curve.length / 2)
    const pin = grabbed + 30
    const deformed = deformConstraintCurve(curve, grabbed, 3, [pin])
    const offsets = deformed.map((point, index) => point.y - curve[index].y)
    expect(offsets[pin]).toBe(0)
    for (let index = pin - 23; index < pin + 23; index += 1) {
      const leftSlope = offsets[index] - offsets[index - 1]
      const rightSlope = offsets[index + 1] - offsets[index]
      expect(Math.abs(rightSlope - leftSlope)).toBeLessThan(0.03)
    }
  })
})

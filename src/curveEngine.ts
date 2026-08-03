export type Transform = { horizontal: number; vertical: number; xScale: number; yScale: number }
export type Point = { x: number; y: number }
export type PointConstraint = Point & { id: string }
export type CurvePoint = Point & { segment: number }
export type CurveSample = Point & { derivative: number; index: number; segment: number }

export type FunctionItem = {
  id: string
  name: string
  expression: string
  color: string
  transform: Transform
  derivative?: boolean
  parameters: Record<string, number>
  freeCurve: CurvePoint[] | null
  freeAnchors: { id: string; index: number; infinity?: 1 | -1 }[]
}

const builtInNames = new Set(['x', 'sin', 'cos', 'tan', 'sqrt', 'abs', 'exp', 'log', 'pi', 'e', 'math'])

export function expressionParameters(expression: string) {
  return [...new Set(expression.toLowerCase().match(/[a-z_]\w*/g) ?? [])].filter((name) => !builtInNames.has(name))
}

export function evaluate(expression: string, x: number, parameters: Record<string, number> = {}) {
  let source = expression
    .trim().toLowerCase().replaceAll('π', 'pi').replaceAll('^', '**')
    .replace(/\bpi\b/g, 'Math.PI').replace(/\be\b/g, 'Math.E')
    .replace(/\b(sin|cos|tan|sqrt|abs|exp|log)\s*\(/g, 'Math.$1(')
  for (const [name, value] of Object.entries(parameters)) source = source.replace(new RegExp(`\\b${name.toLowerCase()}\\b`, 'g'), `(${value})`)
  const remaining = source.replace(/Math\.(?:PI|E|sin|cos|tan|sqrt|abs|exp|log)/g, '')
  if (!/^[\d\s+x*/().,-]+$/.test(remaining)) return Number.NaN
  try {
    const result = Function('x', `"use strict"; return (${source})`)(x)
    return typeof result === 'number' && Number.isFinite(result) ? result : Number.NaN
  } catch {
    return Number.NaN
  }
}

function derivativeValue(expression: string, x: number, parameters: Record<string, number>) {
  const h = Math.max(0.00001, Math.abs(x) * 0.00001)
  return (evaluate(expression, x + h, parameters) - evaluate(expression, x - h, parameters)) / (2 * h)
}

export function baseValue(item: FunctionItem, x: number) {
  const input = item.transform.xScale * (x - item.transform.horizontal)
  const rawY = item.derivative ? derivativeValue(item.expression, input, item.parameters) : evaluate(item.expression, input, item.parameters)
  return item.transform.yScale * rawY + item.transform.vertical
}

export function createFreeCurve(item: FunctionItem, minX = -20, maxX = 20) {
  const step = Math.max(0.02, (maxX - minX) / 1200)
  const curve: CurvePoint[] = []
  let segment = 0
  let previousY = Number.NaN
  for (let x = minX; x <= maxX; x += step) {
    const y = baseValue(item, x)
    if (!Number.isFinite(y)) { previousY = Number.NaN; segment += 1; continue }
    if (Number.isFinite(previousY) && Math.abs(y - previousY) > 20) segment += 1
    curve.push({ x, y, segment })
    previousY = y
  }
  return curve
}

export function deformFreeCurve(curve: CurvePoint[], grabbedIndex: number, dy: number, pinnedIndices: number[] = []) {
  const radius = 52
  const grabbedSegment = curve[grabbedIndex].segment
  const displacements = curve.map(() => 0)
  const fixed = new Map<number, number>([[grabbedIndex, dy], ...pinnedIndices.map((index) => [index, 0] as const)])
  const capRadius = 4
  for (let offset = 1; offset <= capRadius; offset += 1) {
    const capDisplacement = dy * Math.cos((Math.PI * offset) / (2 * (capRadius + 1)))
    const left = grabbedIndex - offset
    const right = grabbedIndex + offset
    if (curve[left]?.segment === grabbedSegment && !fixed.has(left)) fixed.set(left, capDisplacement)
    if (curve[right]?.segment === grabbedSegment && !fixed.has(right)) fixed.set(right, capDisplacement)
  }
  const start = Math.max(0, grabbedIndex - radius)
  const end = Math.min(curve.length - 1, grabbedIndex + radius)

  // Position-based relaxation: neighboring particles repeatedly share displacement.
  for (let pass = 0; pass < 140; pass += 1) {
    const previous = [...displacements]
    for (let index = start + 1; index < end; index += 1) {
      if (curve[index].segment !== grabbedSegment || fixed.has(index)) continue
      displacements[index] = previous[index] * 0.25 + (previous[index - 1] + previous[index + 1]) * 0.375
    }
    for (const [index, value] of fixed) displacements[index] = value
    if (!fixed.has(start)) displacements[start] = 0
    if (!fixed.has(end)) displacements[end] = 0
  }

  return curve.map((point, index) => ({ ...point, y: point.y + displacements[index] }))
}

export function deformConstraintCurve(curve: CurvePoint[], grabbedIndex: number, dy: number, pinnedIndices: number[] = []) {
  const center = curve[grabbedIndex]
  const width = 3.6
  return curve.map((point, index) => {
    if (point.segment !== center.segment) return point
    const distance = Math.abs(point.x - center.x) / width
    if (distance >= 1) return point
    const tail = 1 - distance
    let weight = tail ** 4 * (4 * distance + 1)
    for (const pin of pinnedIndices) {
      const pinDistance = Math.abs(index - pin)
      const pinRadius = 32
      if (pinDistance >= pinRadius) continue
      const pinRatio = pinDistance / pinRadius
      weight *= pinRatio * pinRatio * (3 - 2 * pinRatio)
    }
    return { ...point, y: point.y + dy * weight }
  })
}

export function sampleCurve(curve: CurvePoint[], x: number): CurveSample | null {
  if (curve.length < 2) return null
  let low = 0
  let high = curve.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (curve[middle].x < x) low = middle + 1
    else high = middle
  }
  const right = Math.min(curve.length - 1, low)
  const left = Math.max(0, right - 1)
  if (curve[left].segment !== curve[right].segment || !Number.isFinite(curve[left].y) || !Number.isFinite(curve[right].y) || x < curve[left].x || x > curve[right].x) return null
  const span = curve[right].x - curve[left].x
  if (span <= 0) return null
  const ratio = (x - curve[left].x) / span
  const index = Math.abs(x - curve[left].x) < Math.abs(x - curve[right].x) ? left : right
  const segmentDerivative = (curve[right].y - curve[left].y) / span
  const derivativeLeft = Math.max(0, index - 1)
  const derivativeRight = Math.min(curve.length - 1, index + 1)
  const derivative = (ratio < 0.000001 || ratio > 0.999999) && curve[derivativeLeft].segment === curve[derivativeRight].segment
    ? (curve[derivativeRight].y - curve[derivativeLeft].y) / (curve[derivativeRight].x - curve[derivativeLeft].x)
    : segmentDerivative
  return { x, y: curve[left].y + (curve[right].y - curve[left].y) * ratio, derivative, index, segment: curve[left].segment }
}

export function curveWithInfinity(curve: CurvePoint[], anchors: FunctionItem['freeAnchors']) {
  const result = curve.map((point) => ({ ...point }))
  for (const anchor of anchors.filter((point) => point.infinity)) {
    const center = curve[anchor.index]
    if (!center) continue
    const width = 1.2
    for (let index = 0; index < result.length; index += 1) {
      const ratio = Math.abs(result[index].x - center.x) / width
      if (result[index].segment !== center.segment || ratio >= 1) continue
      result[index].y = ratio < 0.000001 ? anchor.infinity! * Number.POSITIVE_INFINITY : result[index].y + anchor.infinity! * 0.12 * ((1 / (ratio * ratio)) - 1) * ((1 - ratio) ** 2)
    }
  }
  return result
}

export function nearestCurvePoint(curve: CurvePoint[], x: number, y: number, scale: number) {
  let closest: { index: number; distance: number } | null = null
  curve.forEach((point, index) => {
    const distance = Math.hypot(point.x - x, point.y - y) * scale
    if (distance <= 18 && (!closest || distance < closest.distance)) closest = { index, distance }
  })
  return closest as { index: number; distance: number } | null
}

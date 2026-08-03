export type Transform = { horizontal: number; vertical: number; xScale: number; yScale: number }
export type Point = { x: number; y: number }
export type PointConstraint = Point & { id: string }
export type CurvePoint = Point & { segment: number }

export type FunctionItem = {
  id: string
  name: string
  expression: string
  color: string
  transform: Transform
  derivative?: boolean
  anchors: PointConstraint[]
  freeCurve: CurvePoint[] | null
}

const weightCache = new Map<string, number[]>()

export function evaluate(expression: string, x: number) {
  const source = expression
    .trim().toLowerCase().replaceAll('π', 'pi').replaceAll('^', '**')
    .replace(/\bpi\b/g, 'Math.PI').replace(/\be\b/g, 'Math.E')
    .replace(/\b(sin|cos|tan|sqrt|abs|exp|log)\s*\(/g, 'Math.$1(')
  const remaining = source.replace(/Math\.(?:PI|E|sin|cos|tan|sqrt|abs|exp|log)/g, '')
  if (!/^[\d\s+x*/().,-]+$/.test(remaining)) return Number.NaN
  try {
    const result = Function('x', `"use strict"; return (${source})`)(x)
    return typeof result === 'number' && Number.isFinite(result) ? result : Number.NaN
  } catch {
    return Number.NaN
  }
}

function derivativeValue(expression: string, x: number) {
  const h = Math.max(0.00001, Math.abs(x) * 0.00001)
  return (evaluate(expression, x + h) - evaluate(expression, x - h)) / (2 * h)
}

export function baseValue(item: FunctionItem, x: number) {
  const input = item.transform.xScale * (x - item.transform.horizontal)
  const rawY = item.derivative ? derivativeValue(item.expression, input) : evaluate(item.expression, input)
  return item.transform.yScale * rawY + item.transform.vertical
}

function compactKernel(a: number, b: number) {
  const distance = Math.abs(a - b) / 2.4
  if (distance >= 1) return 0
  const tail = 1 - distance
  return tail ** 4 * (4 * distance + 1)
}

function solveSystem(matrix: number[][], values: number[]) {
  const size = values.length
  const augmented = matrix.map((row, index) => [...row, values[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    if (Math.abs(augmented[pivot][column]) < 1e-9) return null
    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]
    const divisor = augmented[column][column]
    for (let cell = column; cell <= size; cell += 1) augmented[column][cell] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let cell = column; cell <= size; cell += 1) augmented[row][cell] -= factor * augmented[column][cell]
    }
  }
  return augmented.map((row) => row[size])
}

export function constraintWeights(item: FunctionItem) {
  if (!item.anchors.length) return []
  const key = `${item.id}|${item.expression}|${item.derivative}|${Object.values(item.transform).join(',')}|${item.anchors.map((anchor) => `${anchor.x},${anchor.y}`).join(';')}`
  const cached = weightCache.get(key)
  if (cached) return cached
  const weights = solveSystem(
    item.anchors.map((anchor) => item.anchors.map((other) => compactKernel(anchor.x, other.x))),
    item.anchors.map((anchor) => anchor.y - baseValue(item, anchor.x)),
  ) ?? item.anchors.map(() => 0)
  weightCache.set(key, weights)
  if (weightCache.size > 200) weightCache.delete(weightCache.keys().next().value!)
  return weights
}

export function constraintValue(item: FunctionItem, x: number) {
  const weights = constraintWeights(item)
  return baseValue(item, x) + item.anchors.reduce((sum, anchor, index) => sum + weights[index] * compactKernel(x, anchor.x), 0)
}

export function constraintExpression(item: FunctionItem, format: (value: number) => string) {
  if (!item.anchors.length) return `${item.name}₀(x)`
  const terms = constraintWeights(item).map((weight, index) => `${format(weight)}·K(x-${format(item.anchors[index].x)})`)
  return `${item.name}₀(x) + ${terms.join(' + ')}`
}

export function createFreeCurve(item: FunctionItem, minX = -20, maxX = 20) {
  const step = Math.max(0.02, (maxX - minX) / 1200)
  const curve: CurvePoint[] = []
  let segment = 0
  let previousY = Number.NaN
  for (let x = minX; x <= maxX; x += step) {
    const y = constraintValue(item, x)
    if (!Number.isFinite(y)) { previousY = Number.NaN; segment += 1; continue }
    if (Number.isFinite(previousY) && Math.abs(y - previousY) > 20) segment += 1
    curve.push({ x, y, segment })
    previousY = y
  }
  return curve
}

export function deformFreeCurve(curve: CurvePoint[], grabbedIndex: number, dx: number, dy: number) {
  const sameSegment = curve.filter((point) => point.segment === curve[grabbedIndex].segment)
  const averageStep = sameSegment.length > 1 ? Math.abs(sameSegment.at(-1)!.x - sameSegment[0].x) / (sameSegment.length - 1) : 0.05
  // A larger horizontal tug must influence a longer section, otherwise the string folds back.
  const radius = Math.max(65, Math.ceil(Math.abs(dx) * 2 / Math.max(averageStep, 0.001)))
  const grabbedSegment = curve[grabbedIndex].segment
  return curve.map((point, index) => {
    if (point.segment !== grabbedSegment) return point
    const distance = Math.abs(index - grabbedIndex)
    if (distance >= radius) return point
    const t = 1 - distance / radius
    const weight = t * t * t * (10 - 15 * t + 6 * t * t)
    return { ...point, x: point.x + dx * weight, y: point.y + dy * weight }
  })
}

export function nearestCurvePoint(curve: CurvePoint[], x: number, y: number, scale: number) {
  let closest: { index: number; distance: number } | null = null
  curve.forEach((point, index) => {
    const distance = Math.hypot(point.x - x, point.y - y) * scale
    if (distance <= 18 && (!closest || distance < closest.distance)) closest = { index, distance }
  })
  return closest as { index: number; distance: number } | null
}

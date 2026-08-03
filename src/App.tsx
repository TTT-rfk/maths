import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

type Transform = { horizontal: number; vertical: number; xScale: number; yScale: number }
type PointConstraint = { id: string; x: number; y: number }
type FunctionItem = { id: string; name: string; expression: string; color: string; transform: Transform; derivative?: boolean; anchors: PointConstraint[]; edits: PointConstraint[] }
type View = { x: number; y: number; scale: number }

const colors = ['#e25d3d', '#176a86', '#a34d9d', '#3f7b5d']
const initialFunctions: FunctionItem[] = [
  { id: 'f', name: 'f', expression: 'x^2 - 2', color: colors[0], transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 }, anchors: [], edits: [] },
  { id: 'g', name: 'g', expression: 'sin(x)', color: colors[1], transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 }, anchors: [], edits: [] },
]

const expressionHelp = '支持: + - * / ^ ( ) | sin cos tan | sqrt abs | exp log | pi e'

function evaluate(expression: string, x: number) {
  const source = expression
    .trim()
    .toLowerCase()
    .replaceAll('π', 'pi')
    .replaceAll('^', '**')
    .replace(/\bpi\b/g, 'Math.PI')
    .replace(/\be\b/g, 'Math.E')
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

function transformExpression(item: FunctionItem) {
  const { horizontal, vertical, xScale, yScale } = item.transform
  const input = xScale === 1 ? 'x' : `${format(xScale)}x`
  const shiftedInput = horizontal === 0 ? input : `(${input} ${horizontal > 0 ? '-' : '+'} ${format(Math.abs(horizontal))})`
  const scaled = yScale === 1 ? `${item.name}₀(${shiftedInput})` : `${format(yScale)}·${item.name}₀(${shiftedInput})`
  const transformed = vertical === 0 ? scaled : `${scaled} ${vertical > 0 ? '+' : '-'} ${format(Math.abs(vertical))}`
  const constraints = [...item.anchors, ...item.edits]
  return constraints.length ? `${transformed} + 局部拟合{${constraints.map((point) => `(${format(point.x)}, ${format(point.y)})`).join(', ')}}` : transformed
}

function format(value: number) {
  return Number(value.toFixed(2)).toString()
}

function derivative(expression: string) {
  return (x: number) => {
    const h = Math.max(0.00001, Math.abs(x) * 0.00001)
    return (evaluate(expression, x + h) - evaluate(expression, x - h)) / (2 * h)
  }
}

function baseValue(item: FunctionItem, x: number) {
  const input = item.transform.xScale * (x - item.transform.horizontal)
  const rawY = item.derivative ? derivative(item.expression)(input) : evaluate(item.expression, input)
  return item.transform.yScale * rawY + item.transform.vertical
}

function solveSystem(matrix: number[][], values: number[]) {
  const size = values.length
  const augmented = matrix.map((row, index) => [...row, values[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    if (Math.abs(augmented[pivot][column]) < 0.000001) return values.map(() => 0)
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

function functionValue(item: FunctionItem, x: number) {
  const points = [...item.anchors, ...item.edits]
  if (!points.length) return baseValue(item, x)
  const width = 1.2
  const kernel = (a: number, b: number) => Math.exp(-(((a - b) / width) ** 2))
  const weights = solveSystem(points.map((point) => points.map((other) => kernel(point.x, other.x))), points.map((point) => point.y - baseValue(item, point.x)))
  return baseValue(item, x) + points.reduce((total, point, index) => total + weights[index] * kernel(x, point.x), 0)
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [functions, setFunctions] = useState(initialFunctions)
  const [selectedIds, setSelectedIds] = useState<string[]>(['f'])
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 54 })
  const longPress = useRef<number | null>(null)
  const delayedMousePress = useRef<number | null>(null)
  const [notice, setNotice] = useState('拖动曲线可局部改变形状。双击曲线，或在触屏端长按曲线，可创建多个白色经过点。')
  const [drag, setDrag] = useState<{ mode: 'pan' | 'reshape' | 'edit'; startX: number; startY: number; view: View; targetId?: string; pointId?: string } | null>(null)

  const selected = functions.filter((item) => selectedIds.includes(item.id))
  const primary = selected[0]

  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#fbfaf7'
    context.fillRect(0, 0, width, height)

    const originX = width / 2 + view.x
    const originY = height / 2 + view.y
    const step = view.scale
    context.lineWidth = 1
    context.strokeStyle = '#e4e1d9'
    for (let x = originX % step; x < width; x += step) line(context, x, 0, x, height)
    for (let y = originY % step; y < height; y += step) line(context, 0, y, width, y)
    context.strokeStyle = '#99958b'
    context.lineWidth = 1.2
    line(context, 0, originY, width, originY)
    line(context, originX, 0, originX, height)
    context.fillStyle = '#77736b'
    context.font = '12px ui-monospace, monospace'
    context.fillText('0', originX + 7, originY + 16)
    context.fillText('x', width - 15, originY - 8)
    context.fillText('y', originX + 8, 16)

    functions.forEach((item) => {
      const isSelected = selectedIds.includes(item.id)
      context.beginPath()
      context.strokeStyle = item.color
      context.lineWidth = isSelected ? 3 : 2
      context.globalAlpha = isSelected ? 1 : 0.66
      let drawing = false
      for (let pixelX = 0; pixelX <= width; pixelX += 1.5) {
        const x = (pixelX - originX) / view.scale
        const y = functionValue(item, x)
        const pixelY = originY - y * view.scale
        if (!Number.isFinite(pixelY) || Math.abs(pixelY - originY) > height * 4) {
          drawing = false
          continue
        }
        if (!drawing) {
          context.moveTo(pixelX, pixelY)
          drawing = true
        } else context.lineTo(pixelX, pixelY)
      }
      context.stroke()
      context.globalAlpha = 1

      if (isSelected) for (const anchor of item.anchors) {
        const handleX = originX + anchor.x * view.scale
        const handleY = originY - functionValue(item, anchor.x) * view.scale
        if (handleX > 12 && handleX < width - 12 && handleY > 12 && handleY < height - 12) {
          context.fillStyle = '#fffdf8'
          context.strokeStyle = item.color
          context.lineWidth = 2
          context.beginPath(); context.arc(handleX, handleY, 6, 0, Math.PI * 2); context.fill(); context.stroke()
        }
      }
    })
  }, [functions, selectedIds, view])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    const resize = () => {
      const rect = host.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      draw(context, rect.width, rect.height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    return () => observer.disconnect()
  }, [draw])

  function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke()
  }

  function getCanvasPoint(clientX: number, clientY: number) {
    const host = hostRef.current
    if (!host) return undefined
    const rect = host.getBoundingClientRect()
    const pixelX = clientX - rect.left
    const pixelY = clientY - rect.top
    const originX = rect.width / 2 + view.x
    const originY = rect.height / 2 + view.y
    return { x: (pixelX - originX) / view.scale, y: (originY - pixelY) / view.scale, pixelX, pixelY }
  }

  function getFunctionAt(clientX: number, clientY: number) {
    const point = getCanvasPoint(clientX, clientY)
    if (!point) return undefined
    const { x, pixelY } = point
    const host = hostRef.current
    if (!host) return undefined
    const rect = host.getBoundingClientRect()
    const originY = rect.height / 2 + view.y
    let closest: { item: FunctionItem; distance: number } | undefined
    for (const item of functions) {
      const y = functionValue(item, x)
      const curveY = originY - y * view.scale
      const distance = Math.abs(curveY - pixelY)
      if (Number.isFinite(distance) && distance < 16 && (!closest || distance < closest.distance)) closest = { item, distance }
    }
    return closest?.item
  }

  function beginCanvasDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = getCanvasPoint(event.clientX, event.clientY)
    if (!point) return
    for (const item of functions) for (const anchor of item.anchors) if (Math.hypot(point.x - anchor.x, point.y - functionValue(item, anchor.x)) * view.scale < 18) {
      setSelectedIds([item.id]); setNotice(`正在移动 ${item.name}(x) 的经过点，曲线会始终通过白点。`)
      setDrag({ mode: 'reshape', startX: event.clientX, startY: event.clientY, view, targetId: item.id, pointId: anchor.id }); return
    }
    const hit = getFunctionAt(event.clientX, event.clientY)
    if (hit) {
      setSelectedIds([hit.id])
      const edit = { id: `edit-${Date.now()}`, x: point.x, y: functionValue(hit, point.x) }
      setNotice(`正在局部重塑 ${hit.name}(x)。拖到目标位置后松开。`)
      setDrag({ mode: 'edit', startX: event.clientX, startY: event.clientY, view, targetId: hit.id, pointId: edit.id })
      setFunctions((current) => current.map((item) => item.id === hit.id ? { ...item, edits: [...item.edits, edit] } : item))
      return
    }
    setDrag({ mode: 'pan', startX: event.clientX, startY: event.clientY, view })
  }

  function createAnchor(clientX: number, clientY: number) {
    const point = getCanvasPoint(clientX, clientY)
    const hit = getFunctionAt(clientX, clientY)
    if (!point || !hit) return
    const anchor = { id: `anchor-${Date.now()}`, x: point.x, y: functionValue(hit, point.x) }
    setFunctions((current) => current.map((item) => item.id === hit.id ? { ...item, anchors: [...item.anchors, anchor] } : item))
    setSelectedIds([hit.id])
    setNotice(`已添加第 ${hit.anchors.length + 1} 个白色经过点。拖动它可重新塑形函数。`)
  }

  function movePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.mode === 'pan') setView({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy })
    if ((drag.mode === 'reshape' || drag.mode === 'edit') && drag.targetId && drag.pointId) {
      const point = getCanvasPoint(event.clientX, event.clientY)
      if (!point) return
      setFunctions((current) => current.map((item) => item.id !== drag.targetId ? item : { ...item, [drag.mode === 'reshape' ? 'anchors' : 'edits']: item[drag.mode === 'reshape' ? 'anchors' : 'edits'].map((entry) => entry.id === drag.pointId ? { ...entry, x: point.x, y: point.y } : entry) }))
    }
  }

  function addFunction() {
    const index = functions.length
    const next = { id: `f${Date.now()}`, name: String.fromCharCode(102 + index), expression: 'x', color: colors[index % colors.length], transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 }, anchors: [], edits: [] }
    setFunctions([...functions, next])
    setSelectedIds([next.id])
    setNotice('已添加新函数。直接在左侧修改表达式。')
  }

  function addDerivative() {
    if (!primary) return
    const derivativeItem: FunctionItem = { id: `d${Date.now()}`, name: `${primary.name}'`, expression: primary.expression, color: colors[functions.length % colors.length], transform: primary.transform, derivative: true, anchors: [], edits: [] }
    setFunctions([...functions, derivativeItem])
    setSelectedIds([derivativeItem.id])
    setNotice(`已创建 ${primary.name} 的数值导函数。它会随原式变换同步。`)
  }

  return <main className="app-shell">
    <header className="topbar">
      <div><span className="brand-mark">ƒ</span><strong>函数画布</strong><span className="subtitle">图形即操作</span></div>
      <div className="topbar-actions"><button type="button" onClick={() => setView({ x: 0, y: 0, scale: 54 })}>重置视图</button><button className="primary" type="button" onClick={addFunction}>+ 新函数</button></div>
    </header>

    <section className="workspace">
      <aside className="function-panel" aria-label="函数列表">
        <div className="panel-heading"><span>表达式</span><span>{functions.length} 个对象</span></div>
        <div className="function-list">
          {functions.map((item) => <article className={`function-card ${selectedIds.includes(item.id) ? 'selected' : ''}`} key={item.id}>
            <button className="function-select" type="button" onClick={() => { setSelectedIds([item.id]); setNotice(`已选择 ${item.name}(x)。`) }} aria-label={`选择 ${item.name}(x)`}><span style={{ background: item.color }} /><b>{item.name}</b></button>
            <label htmlFor={`expression-${item.id}`}>{item.name}(x) =</label>
            <input id={`expression-${item.id}`} value={item.expression} onChange={(event) => setFunctions((current) => current.map((value) => value.id === item.id ? { ...value, expression: event.target.value } : value))} spellCheck="false" />
            {selectedIds.includes(item.id) && <p className="transform-text">{transformExpression(item)}</p>}
          </article>)}
        </div>
        <p className="expression-help">{expressionHelp}</p>
      </aside>

      <section className="canvas-area" aria-label="函数图像画布">
        <div className="canvas-host" ref={hostRef} onPointerDown={(event) => { if (event.pointerType === 'mouse') { delayedMousePress.current = window.setTimeout(() => beginCanvasDrag(event), 180); return }; longPress.current = window.setTimeout(() => createAnchor(event.clientX, event.clientY), 550) }} onPointerMove={(event) => { if (delayedMousePress.current) { window.clearTimeout(delayedMousePress.current); delayedMousePress.current = null; beginCanvasDrag(event) }; if (longPress.current) { window.clearTimeout(longPress.current); longPress.current = null; beginCanvasDrag(event) }; movePointer(event) }} onPointerUp={() => { if (delayedMousePress.current) window.clearTimeout(delayedMousePress.current); delayedMousePress.current = null; if (longPress.current) window.clearTimeout(longPress.current); longPress.current = null; setDrag(null) }} onPointerCancel={() => { if (delayedMousePress.current) window.clearTimeout(delayedMousePress.current); delayedMousePress.current = null; if (longPress.current) window.clearTimeout(longPress.current); longPress.current = null; setDrag(null) }} onDoubleClick={(event) => { if (delayedMousePress.current) window.clearTimeout(delayedMousePress.current); delayedMousePress.current = null; createAnchor(event.clientX, event.clientY) }}>
          <canvas ref={canvasRef} />
          <p className="canvas-note">{notice}</p>
        </div>
        <div className="floating-toolbar" aria-label="函数操作">
          <button type="button" disabled={!primary} onClick={addDerivative}>求导</button>
          <button type="button" disabled={selected.length !== 2} onClick={() => setNotice('函数组合将在下一步接入符号运算引擎。')}>组合</button>
          <button type="button" disabled={!primary} onClick={() => setNotice('直接拖动已选曲线即可移动它。白色圆点标记了曲线的可见控制点。')}>变换</button>
          <button type="button" disabled={!primary} onClick={() => setNotice('分析功能将在符号引擎接入后提供。')}>分析</button>
        </div>
      </section>

      <aside className="inspector" aria-label="所选函数属性">
        <p className="eyebrow">当前对象</p>
        {primary ? <><h1>{primary.name}(x)</h1><p className="expression-large">{transformExpression(primary)}</p><div className="rule" /><p className="eyebrow">图形变换</p><dl><dt>水平平移</dt><dd>{format(primary.transform.horizontal)}</dd><dt>垂直平移</dt><dd>{format(primary.transform.vertical)}</dd><dt>水平缩放</dt><dd>{format(primary.transform.xScale)}</dd><dt>垂直缩放</dt><dd>{format(primary.transform.yScale)}</dd></dl><p className="hint">直接按住曲线拖动即可平移函数；按住空白处拖动才会移动坐标系。</p></> : <p>选择一条函数查看属性。</p>}
      </aside>
    </section>
  </main>
}

export default App

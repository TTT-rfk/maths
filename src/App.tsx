import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createFreeCurve,
  curveWithInfinity,
  deformConstraintCurve,
  deformFreeCurve,
  nearestCurvePoint,
  sampleCurve,
  expressionParameters,
  type CurvePoint,
  type FunctionItem,
} from './curveEngine'
import './App.css'

type View = { x: number; y: number; scale: number }
type Mode = 'constraint' | 'freeform'
type Drag =
  | { type: 'pan'; startClientX: number; startClientY: number; startView: View }
  | { type: 'point'; functionId: string; pointId: string; index: number; startY: number; source: CurvePoint[]; pinnedIndices: number[] }

type Readout = { functionId: string; x: number; y: number; derivative: number; clientX: number; clientY: number }
type CanvasPage = { id: string; name: string; functions: FunctionItem[]; selectedId: string; view: View; mode: Mode }

const colors = ['#e25d3d', '#176a86', '#a34d9d', '#3f7b5d']
const transform = { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 }
const initialFunctions: FunctionItem[] = [
  { id: 'f', name: 'f', expression: 'x^2 - 2', color: colors[0], transform, parameters: {}, freeCurve: null, freeAnchors: [] },
  { id: 'g', name: 'g', expression: 'sin(x)', color: colors[1], transform, parameters: {}, freeCurve: null, freeAnchors: [] },
]

function freshPage(index: number): CanvasPage {
  const functions = initialFunctions.map((item) => ({ ...item, transform: { ...item.transform }, parameters: {}, freeAnchors: [], freeCurve: createFreeCurve(item) }))
  return { id: `page-${Date.now()}-${index}`, name: `画布 ${index}`, functions, selectedId: 'f', view: { x: 0, y: 0, scale: 54 }, mode: 'constraint' }
}

function loadPages() {
  try {
    const saved = localStorage.getItem('function-canvas-pages')
    if (saved) {
      const pages = JSON.parse(saved) as CanvasPage[]
      if (pages.length) return pages.map((page) => ({ ...page, functions: page.functions.map((item) => ({ ...item, parameters: item.parameters ?? {}, freeAnchors: item.freeAnchors ?? [], freeCurve: item.freeCurve ?? createFreeCurve({ ...item, parameters: item.parameters ?? {}, freeAnchors: [] }) })) }))
    }
  } catch {
    // Corrupt or unavailable storage falls back to a clean canvas.
  }
  return [freshPage(1)]
}

function loadCurrentPageId(pages: CanvasPage[]) {
  try {
    const saved = localStorage.getItem('function-canvas-current-page')
    if (pages.some((page) => page.id === saved)) return saved!
  } catch {
    // Storage may be disabled in sandboxed browsers.
  }
  return pages[0].id
}

const expressionHelp = '支持: + - * / ^ ( ) | sin cos tan | sqrt abs | exp log | pi e'

function format(value: number) {
  return Number(value.toFixed(2)).toString()
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const longPressRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)
  const activePointerRef = useRef<number | null>(null)
  const pressPointRef = useRef<{ x: number; y: number } | null>(null)
  const pendingTouchReadoutRef = useRef<Readout | null>(null)
  const pendingTouchPanRef = useRef<Extract<Drag, { type: 'pan' }> | null>(null)
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; scale: number; graphX: number; graphY: number } | null>(null)
  const [pages, setPages] = useState(loadPages)
  const [currentPageId, setCurrentPageId] = useState(() => loadCurrentPageId(pages))
  const initialPage = pages.find((page) => page.id === currentPageId) ?? pages[0]
  const [functions, setFunctions] = useState(() => initialPage.functions)
  const [selectedId, setSelectedId] = useState(() => initialPage.selectedId)
  const [view, setView] = useState<View>(() => initialPage.view)
  const [mode, setMode] = useState<Mode>(() => initialPage.mode)
  const [selectedPoint, setSelectedPoint] = useState<{ functionId: string; pointId: string } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<Readout | null>(null)
  const [fixedReadout, setFixedReadout] = useState<Readout | null>(null)
  const [notice, setNotice] = useState('约束模式：双击曲线或触屏长按创建白点，只有拖动白点才会改变函数。')

  const selected = functions.find((item) => item.id === selectedId)
  const selectedPointAvailable = Boolean(selected && selectedPoint?.functionId === selected.id && selected.freeAnchors.some((anchor) => anchor.id === selectedPoint.pointId))
  const selectedAnchor = selectedPointAvailable ? selected?.freeAnchors.find((anchor) => anchor.id === selectedPoint!.pointId) : undefined

  useEffect(() => {
    setPages((current) => current.map((page) => page.id === currentPageId ? { ...page, functions, selectedId, view, mode } : page))
  }, [currentPageId, functions, mode, selectedId, view])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem('function-canvas-pages', JSON.stringify(pages)); localStorage.setItem('function-canvas-current-page', currentPageId) } catch { /* Storage quota is non-fatal. */ }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [currentPageId, pages])

  useEffect(() => {
    const flush = () => {
      try { localStorage.setItem('function-canvas-pages', JSON.stringify(pages)); localStorage.setItem('function-canvas-current-page', currentPageId) } catch { /* Best effort on exit. */ }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [currentPageId, pages])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!selectedPoint) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      const infinity = event.altKey && event.key === 'ArrowUp' ? 1 : event.altKey && event.key === 'ArrowDown' ? -1 : event.key === 'Escape' ? 0 : null
      if (infinity === null) return
      event.preventDefault()
      setFunctions((items) => items.map((item) => item.id === selectedPoint.functionId ? { ...item, freeAnchors: item.freeAnchors.map((anchor) => anchor.id === selectedPoint.pointId ? { ...anchor, infinity: infinity || undefined } : anchor) } : item))
      setNotice(infinity === 1 ? '控制点已设为 y=+∞。' : infinity === -1 ? '控制点已设为 y=-∞。' : '控制点已恢复到有限位置。')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedPoint])

  function switchPage(page: CanvasPage) {
    setCurrentPageId(page.id); setFunctions(page.functions); setSelectedId(page.selectedId); setView(page.view); setMode(page.mode)
    setSelectedPoint(null); setHover(null); setFixedReadout(null)
  }

  function addPage() {
    const page = freshPage(pages.length + 1)
    setPages((current) => [...current, page]); switchPage(page)
  }

  function toGraphPoint(clientX: number, clientY: number) {
    const host = hostRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    const originX = rect.width / 2 + view.x
    const originY = rect.height / 2 + view.y
    return { x: (clientX - rect.left - originX) / view.scale, y: (originY - (clientY - rect.top)) / view.scale }
  }

  function readoutAt(clientX: number, clientY: number) {
    const hit = hitFunction(clientX, clientY)
    const point = toGraphPoint(clientX, clientY)
    const sample = hit && point ? sampleCurve(displayCurveFor(hit.item), point.x) : null
    return hit && sample ? { functionId: hit.item.id, x: sample.x, y: sample.y, derivative: sample.derivative, clientX, clientY } : null
  }

  function tooltipStyle(readout: Readout) {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return { left: 8, top: 8 }
    return { left: Math.max(8, Math.min(rect.width - 145, readout.clientX - rect.left + 14)), top: Math.max(8, Math.min(rect.height - 70, readout.clientY - rect.top + 14)) }
  }

  function curveFor(item: FunctionItem) {
    return item.freeCurve ?? createFreeCurve(item)
  }

  function displayCurveFor(item: FunctionItem) {
    return curveWithInfinity(curveFor(item), item.freeAnchors)
  }

  function hitFunction(clientX: number, clientY: number) {
    const point = toGraphPoint(clientX, clientY)
    if (!point) return null
    let closest: { item: FunctionItem; distance: number; freeIndex?: number } | null = null
    for (const item of functions) {
      const hit = nearestCurvePoint(displayCurveFor(item), point.x, point.y, view.scale)
      if (hit && (!closest || hit.distance < closest.distance)) closest = { item, distance: hit.distance, freeIndex: hit.index }
    }
    return closest
  }

  function hitAnchor(clientX: number, clientY: number) {
    const item = functions.find((candidate) => candidate.id === selectedId)
    const host = hostRef.current
    if (!item || !host) return null
    const rect = host.getBoundingClientRect()
    const originX = rect.width / 2 + view.x
    const originY = rect.height / 2 + view.y
    const curve = curveFor(item)
    for (const anchor of item.freeAnchors) {
      const curvePoint = curve[anchor.index]
      if (!curvePoint) continue
      const px = rect.left + originX + curvePoint.x * view.scale
      const py = rect.top + (anchor.infinity === 1 ? 14 : anchor.infinity === -1 ? rect.height - 14 : originY - curvePoint.y * view.scale)
      if (Math.hypot(px - clientX, py - clientY) <= 18) return { item, anchor, curvePoint }
    }
    return null
  }

  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    const originX = width / 2 + view.x
    const originY = height / 2 + view.y
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#fbfaf7'; context.fillRect(0, 0, width, height)
    context.strokeStyle = '#e4e1d9'; context.lineWidth = 1
    for (let x = originX % view.scale; x < width; x += view.scale) line(context, x, 0, x, height)
    for (let y = originY % view.scale; y < height; y += view.scale) line(context, 0, y, width, y)
    context.strokeStyle = '#99958b'; context.lineWidth = 1.2
    line(context, 0, originY, width, originY); line(context, originX, 0, originX, height)

    for (const item of functions) {
      const active = item.id === selectedId
      context.beginPath(); context.strokeStyle = item.color; context.lineWidth = active ? 3 : 2; context.globalAlpha = active ? 1 : 0.6
      let started = false
      let previousSegment = -1
      for (const point of displayCurveFor(item)) {
        const px = originX + point.x * view.scale
        const py = originY - point.y * view.scale
        if (!Number.isFinite(py) || Math.abs(py - originY) > height * 4) { started = false; continue }
        if (point.segment !== previousSegment) started = false
        if (!started) { context.moveTo(px, py); started = true } else context.lineTo(px, py)
        previousSegment = point.segment
      }
      context.stroke(); context.globalAlpha = 1
      if (active) for (const anchor of item.freeAnchors) {
        const point = curveFor(item)[anchor.index]
        if (!point) continue
        context.beginPath(); context.fillStyle = '#fffdf8'; context.strokeStyle = item.color; context.lineWidth = 2
        const anchorY = anchor.infinity === 1 ? 14 : anchor.infinity === -1 ? height - 14 : originY - point.y * view.scale
        context.arc(originX + point.x * view.scale, anchorY, 5, 0, Math.PI * 2); context.fill(); context.stroke()
        if (anchor.infinity) { context.fillStyle = item.color; context.font = '12px ui-monospace, monospace'; context.fillText(anchor.infinity > 0 ? '+∞' : '-∞', originX + point.x * view.scale + 8, anchorY + 4) }
      }
    }
    if (fixedReadout?.functionId === selectedId) {
      const span = 1.2
      context.strokeStyle = '#1e6254'; context.lineWidth = 1.5; context.setLineDash([5, 4])
      line(context, originX + (fixedReadout.x - span) * view.scale, originY - (fixedReadout.y - fixedReadout.derivative * span) * view.scale, originX + (fixedReadout.x + span) * view.scale, originY - (fixedReadout.y + fixedReadout.derivative * span) * view.scale)
      context.setLineDash([])
    }
  }, [fixedReadout, functions, selectedId, view])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const resize = () => {
      const rect = host.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio)
      canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0); draw(context, rect.width, rect.height)
    }
    const observer = new ResizeObserver(resize); observer.observe(host); resize()
    return () => observer.disconnect()
  }, [draw])

  useEffect(() => {
    if (!fixedReadout) return
    const item = functions.find((candidate) => candidate.id === fixedReadout.functionId)
    const sample = item ? sampleCurve(displayCurveFor(item), fixedReadout.x) : null
    if (!sample) { setFixedReadout(null); return }
    if (Math.abs(sample.y - fixedReadout.y) < 0.000001 && Math.abs(sample.derivative - fixedReadout.derivative) < 0.000001) return
    setFixedReadout((current) => current ? { ...current, y: sample.y, derivative: sample.derivative } : null)
  }, [fixedReadout, functions])

  useEffect(() => { setHover(null) }, [functions])

  function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke()
  }

  function createAnchor(clientX: number, clientY: number) {
    const hit = hitFunction(clientX, clientY)
    if (!hit || hit.freeIndex === undefined || hit.item.freeAnchors.some((anchor) => Math.abs(anchor.index - hit.freeIndex!) < 8)) return
    const anchor = { id: `point-${Date.now()}`, index: hit.freeIndex }
    setFunctions((items) => items.map((item) => item.id === hit.item.id ? { ...item, freeAnchors: [...item.freeAnchors, anchor] } : item))
    setSelectedPoint({ functionId: hit.item.id, pointId: anchor.id })
    setSelectedId(hit.item.id); setNotice('控制点已创建。两种模式都只能通过拖动白点改变曲线。')
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchPointsRef.current.size === 2) {
        const [first, second] = [...touchPointsRef.current.values()]
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        const graph = toGraphPoint(midpoint.x, midpoint.y)
        if (graph) pinchRef.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), scale: view.scale, graphX: graph.x, graphY: graph.y }
        if (longPressRef.current) window.clearTimeout(longPressRef.current)
        longPressRef.current = null; pendingTouchReadoutRef.current = null; pendingTouchPanRef.current = null; activePointerRef.current = null; setDrag(null)
        return
      }
    }
    if (activePointerRef.current !== null && activePointerRef.current !== event.pointerId) return
    activePointerRef.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer tests and some embedded browsers do not expose an active pointer.
    }
    pressPointRef.current = { x: event.clientX, y: event.clientY }
    longPressTriggeredRef.current = false
    const anchorHit = hitAnchor(event.clientX, event.clientY)
    if (anchorHit) {
      const source = curveFor(anchorHit.item)
      const readout = sampleCurve(source, anchorHit.curvePoint.x)
      setSelectedId(anchorHit.item.id)
      setSelectedPoint({ functionId: anchorHit.item.id, pointId: anchorHit.anchor.id })
      if (anchorHit.anchor.infinity) { setNotice('该控制点位于无穷状态，请在详情页恢复后再拖动。'); return }
      if (readout) setFixedReadout({ functionId: anchorHit.item.id, x: readout.x, y: readout.y, derivative: readout.derivative, clientX: event.clientX, clientY: event.clientY })
      setDrag({ type: 'point', functionId: anchorHit.item.id, pointId: anchorHit.anchor.id, index: anchorHit.anchor.index, startY: anchorHit.curvePoint.y, source, pinnedIndices: anchorHit.item.freeAnchors.filter((anchor) => anchor.id !== anchorHit.anchor.id).map((anchor) => anchor.index) })
      return
    }
    const hit = hitFunction(event.clientX, event.clientY)
    if (event.pointerType !== 'mouse' && hit) {
      pendingTouchReadoutRef.current = readoutAt(event.clientX, event.clientY)
      pendingTouchPanRef.current = { type: 'pan', startClientX: event.clientX, startClientY: event.clientY, startView: view }
      longPressRef.current = window.setTimeout(() => { longPressTriggeredRef.current = true; pendingTouchReadoutRef.current = null; pendingTouchPanRef.current = null; createAnchor(event.clientX, event.clientY) }, 550)
      setSelectedId(hit.item.id)
      return
    }
    if (hit) {
      setSelectedId(hit.item.id)
      const graphPoint = toGraphPoint(event.clientX, event.clientY)
      const sample = graphPoint ? sampleCurve(displayCurveFor(hit.item), graphPoint.x) : null
      if (sample) setFixedReadout({ functionId: hit.item.id, x: sample.x, y: sample.y, derivative: sample.derivative, clientX: event.clientX, clientY: event.clientY })
      setNotice('曲线只能通过白点拖动；当前点击已固定该点读数。')
      return
    }
    setDrag({ type: 'pan', startClientX: event.clientX, startClientY: event.clientY, startView: view })
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' && touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinchRef.current && touchPointsRef.current.size >= 2) {
        const host = hostRef.current
        if (!host) return
        const [first, second] = [...touchPointsRef.current.values()]
        const rect = host.getBoundingClientRect()
        const midpointX = (first.x + second.x) / 2 - rect.left
        const midpointY = (first.y + second.y) / 2 - rect.top
        const distance = Math.hypot(first.x - second.x, first.y - second.y)
        const scale = Math.max(18, Math.min(220, pinchRef.current.scale * distance / Math.max(pinchRef.current.distance, 1)))
        setView({ scale, x: midpointX - rect.width / 2 - pinchRef.current.graphX * scale, y: midpointY - rect.height / 2 + pinchRef.current.graphY * scale })
        return
      }
    }
    if (activePointerRef.current !== null && activePointerRef.current !== event.pointerId) return
    if (longPressRef.current && pressPointRef.current && Math.hypot(event.clientX - pressPointRef.current.x, event.clientY - pressPointRef.current.y) > 8) {
      window.clearTimeout(longPressRef.current); longPressRef.current = null
      pendingTouchReadoutRef.current = null
      if (pendingTouchPanRef.current) {
        const pan = pendingTouchPanRef.current
        pendingTouchPanRef.current = null
        setDrag(pan)
        setView({ ...pan.startView, x: pan.startView.x + event.clientX - pan.startClientX, y: pan.startView.y + event.clientY - pan.startClientY })
        return
      }
    }
    if (!drag) {
      const hit = hitFunction(event.clientX, event.clientY)
      const graphPoint = toGraphPoint(event.clientX, event.clientY)
      const sample = hit && graphPoint ? sampleCurve(displayCurveFor(hit.item), graphPoint.x) : null
      setHover(sample && hit ? { functionId: hit.item.id, x: sample.x, y: sample.y, derivative: sample.derivative, clientX: event.clientX, clientY: event.clientY } : null)
      return
    }
    if (drag.type === 'pan') {
      setView({ ...drag.startView, x: drag.startView.x + event.clientX - drag.startClientX, y: drag.startView.y + event.clientY - drag.startClientY }); return
    }
    const point = toGraphPoint(event.clientX, event.clientY)
    if (!point) return
    setFunctions((items) => items.map((item) => item.id === drag.functionId ? { ...item, freeCurve: mode === 'freeform'
      ? deformFreeCurve(drag.source, drag.index, point.y - drag.startY, drag.pinnedIndices)
      : deformConstraintCurve(drag.source, drag.index, point.y - drag.startY, drag.pinnedIndices) } : item))
  }

  function endPointer(event?: React.PointerEvent<HTMLDivElement>, commitReadout = true) {
    if (event?.pointerType === 'touch') {
      touchPointsRef.current.delete(event.pointerId)
      if (pinchRef.current) {
        if (touchPointsRef.current.size < 2) pinchRef.current = null
        activePointerRef.current = null; setDrag(null)
        return
      }
    }
    if (event && activePointerRef.current !== event.pointerId) return
    if (commitReadout && !longPressTriggeredRef.current && pendingTouchReadoutRef.current) setFixedReadout(pendingTouchReadoutRef.current)
    if (longPressRef.current) window.clearTimeout(longPressRef.current)
    longPressRef.current = null; longPressTriggeredRef.current = false; activePointerRef.current = null; pressPointRef.current = null; pendingTouchReadoutRef.current = null; pendingTouchPanRef.current = null; setDrag(null)
  }

  function switchMode(next: Mode) {
    setMode(next)
    setSelectedPoint(null)
    setNotice(next === 'freeform' ? '棉线模式：拖动白点，使用较窄的质点链张力传播。' : '数学约束模式：拖动同一批白点，使用较宽的数学影响核。')
  }

  function deleteSelectedPoint() {
    if (!selectedPointAvailable || !selectedPoint) return
    setFunctions((items) => items.map((item) => item.id !== selectedPoint.functionId ? item : { ...item, freeAnchors: item.freeAnchors.filter((anchor) => anchor.id !== selectedPoint.pointId) }))
    setSelectedPoint(null)
    setNotice('已删除选中的白点。')
  }

  function setPointInfinity(functionId: string, pointId: string, infinity?: 1 | -1) {
    setSelectedPoint({ functionId, pointId })
    setFunctions((items) => items.map((item) => item.id === functionId ? { ...item, freeAnchors: item.freeAnchors.map((anchor) => anchor.id === pointId ? { ...anchor, infinity } : anchor) } : item))
    setNotice(infinity === 1 ? '控制点已设为 y=+∞。' : infinity === -1 ? '控制点已设为 y=-∞。' : '控制点已恢复到有限位置。')
  }

  function addFunction() {
    const index = functions.length
    const nextBase: FunctionItem = { id: `f${Date.now()}`, name: String.fromCharCode(102 + index), expression: 'x', color: colors[index % colors.length], transform: { ...transform }, parameters: {}, freeCurve: null, freeAnchors: [] }
    const next = { ...nextBase, freeCurve: createFreeCurve(nextBase) }
    setFunctions([...functions, next]); setSelectedId(next.id)
  }

  function addDerivative() {
    if (!selected) return
    const base: FunctionItem = { id: `d${Date.now()}`, name: `${selected.name}'`, expression: selected.expression, color: colors[functions.length % colors.length], transform: { ...selected.transform }, parameters: { ...selected.parameters }, derivative: true, freeCurve: null, freeAnchors: [] }
    const item = { ...base, freeCurve: createFreeCurve(base) }
    setFunctions([...functions, item]); setSelectedId(item.id)
  }

  function updateParameter(name: string, value: number) {
    if (!selected || !Number.isFinite(value)) return
    setFunctions((items) => items.map((item) => {
      if (item.id !== selected.id) return item
      const base = { ...item, parameters: { ...item.parameters, [name]: value }, freeCurve: null }
      return { ...base, freeCurve: createFreeCurve(base) }
    }))
  }

  return <main className="app-shell">
    <header className="topbar">
      <div><span className="brand-mark">ƒ</span><strong>函数画布</strong><span className="subtitle">图形即操作</span></div>
      <div className="topbar-actions"><button type="button" onClick={() => setView({ x: 0, y: 0, scale: 54 })}>重置视图</button><button className="primary" type="button" onClick={addFunction}>+ 新函数</button></div>
    </header>
    <section className="workspace">
      <aside className="function-panel" aria-label="函数列表">
        <div className="panel-heading"><span>表达式</span><span>{functions.length} 个对象</span></div>
        <div className="function-list">{functions.map((item) => <article className={`function-card ${item.id === selectedId ? 'selected' : ''}`} key={item.id}>
          <button className="function-select" type="button" onClick={() => setSelectedId(item.id)}><span style={{ background: item.color }} /><b>{item.name}</b></button>
          <label htmlFor={`expression-${item.id}`}>{item.name}(x) =</label>
          <input id={`expression-${item.id}`} value={item.expression} onChange={(event) => {
            const expression = event.target.value
            setFunctions((items) => items.map((value) => {
              if (value.id !== item.id) return value
              const names = expressionParameters(expression)
              const parameters = Object.fromEntries(names.map((name) => [name, value.parameters[name] ?? 1]))
              const base = { ...value, expression, parameters, freeCurve: null, freeAnchors: [] }
              return { ...base, freeCurve: createFreeCurve(base) }
            }))
          }} spellCheck="false" />
        </article>)}</div>
        <p className="expression-help">{expressionHelp}</p>
      </aside>
      <section className="canvas-area" aria-label="函数图像画布">
        <div className="canvas-mode-switch"><button className={mode === 'constraint' ? 'active' : ''} type="button" onClick={() => switchMode('constraint')}>1 约束</button><button className={mode === 'freeform' ? 'active' : ''} type="button" onClick={() => switchMode('freeform')}>3 棉线</button><button type="button" disabled={!selectedPointAvailable} onClick={deleteSelectedPoint}>删除点</button></div>
        <div className="mobile-quick-controls">
          {selected && expressionParameters(selected.expression).map((name) => <label key={name}><span>{name}</span><input type="range" min="-10" max="10" step="0.1" value={selected.parameters[name] ?? 1} onChange={(event) => updateParameter(name, Number(event.target.value))} /><output>{format(selected.parameters[name] ?? 1)}</output></label>)}
          {selected && selectedAnchor && <div><span>点: {selectedAnchor.infinity === 1 ? '+∞' : selectedAnchor.infinity === -1 ? '-∞' : '有限'}</span><button type="button" onClick={() => setPointInfinity(selected.id, selectedAnchor.id, 1)}>+∞</button><button type="button" onClick={() => setPointInfinity(selected.id, selectedAnchor.id, -1)}>-∞</button><button type="button" onClick={() => setPointInfinity(selected.id, selectedAnchor.id)}>恢复</button></div>}
        </div>
        <div className="canvas-host" ref={hostRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => endPointer(event)} onPointerCancel={(event) => endPointer(event, false)} onPointerLeave={() => setHover(null)} onDoubleClick={(event) => { if (!hitAnchor(event.clientX, event.clientY)) createAnchor(event.clientX, event.clientY) }}>
          <canvas ref={canvasRef} />
          {hover && <div className="point-tooltip" style={tooltipStyle(hover)}><strong>({format(hover.x)}, {format(hover.y)})</strong><span>导数 {format(hover.derivative)}</span></div>}
          {fixedReadout && <div className="fixed-readout-overlay"><strong>({format(fixedReadout.x)}, {format(fixedReadout.y)})</strong><span>导数 {format(fixedReadout.derivative)}</span><span>切线 y - {format(fixedReadout.y)} = {format(fixedReadout.derivative)}(x - {format(fixedReadout.x)})</span><button type="button" onClick={(event) => { event.stopPropagation(); setFixedReadout(null) }}>关闭</button></div>}
          <p className="canvas-note">{notice}</p>
        </div>
        <div className="floating-toolbar"><button type="button" disabled={!selected} onClick={addDerivative}>求导</button><button type="button" disabled>组合</button><button type="button" disabled>分析</button></div>
      </section>
      <aside className="inspector" aria-label="所选函数属性">
        <p className="eyebrow">当前对象</p>
        {selected ? <>
          <h1>{selected.name}(x)</h1><p className="expression-large">{selected.expression} + 控制点变形</p>
          {expressionParameters(selected.expression).length > 0 && <><div className="rule" /><p className="eyebrow">自由参数</p><div className="parameter-list">{expressionParameters(selected.expression).map((name) => <label key={name}><span>{name}</span><input type="range" min="-10" max="10" step="0.1" value={selected.parameters[name] ?? 1} onChange={(event) => updateParameter(name, Number(event.target.value))} /><input type="number" step="0.1" value={selected.parameters[name] ?? 1} onChange={(event) => updateParameter(name, Number(event.target.value))} /></label>)}</div></>}
          <div className="rule" /><p className="eyebrow">拖拽模式</p>
          <div className="mode-switch"><button className={mode === 'constraint' ? 'active' : ''} type="button" onClick={() => switchMode('constraint')}>1 数学约束</button><button className={mode === 'freeform' ? 'active' : ''} type="button" onClick={() => switchMode('freeform')}>3 棉线张力</button></div>
          <p className="hint">两种模式操作同一条曲线和同一批白点；控制点只能上下移动。</p>
          <p className="eyebrow">控制点</p>
          <div className="anchor-list">{selected.freeAnchors.length ? selected.freeAnchors.map((anchor, index) => <div key={anchor.id}><span>点 {index + 1}: {anchor.infinity === 1 ? '+∞' : anchor.infinity === -1 ? '-∞' : '有限'}</span><button type="button" onClick={() => setSelectedPoint({ functionId: selected.id, pointId: anchor.id })}>选择</button><button type="button" onClick={() => setPointInfinity(selected.id, anchor.id, 1)}>+∞</button><button type="button" onClick={() => setPointInfinity(selected.id, anchor.id, -1)}>-∞</button><button type="button" onClick={() => setPointInfinity(selected.id, anchor.id)}>恢复</button><button type="button" onClick={() => setFunctions((items) => items.map((item) => item.id === selected.id ? { ...item, freeAnchors: item.freeAnchors.filter((entry) => entry.id !== anchor.id) } : item))}>删除</button></div>) : <p>暂无白点</p>}</div>
          {fixedReadout && fixedReadout.functionId === selected.id && <div className="fixed-readout"><span>固定点 ({format(fixedReadout.x)}, {format(fixedReadout.y)})</span><span>导数 {format(fixedReadout.derivative)}</span><span>切线 y - {format(fixedReadout.y)} = {format(fixedReadout.derivative)}(x - {format(fixedReadout.x)})</span><button type="button" onClick={() => setFixedReadout(null)}>取消固定</button></div>}
          <button className="clear-edits" type="button" onClick={() => setFunctions((items) => items.map((item) => { if (item.id !== selected.id) return item; const base = { ...item, freeCurve: null, freeAnchors: [] }; return { ...base, freeCurve: createFreeCurve(base) } }))}>恢复原函数形状</button>
        </> : <p>选择一条函数。</p>}
      </aside>
    </section>
    <nav className="page-tabs" aria-label="画布分页">{pages.map((page) => <button className={page.id === currentPageId ? 'active' : ''} type="button" key={page.id} onClick={() => switchPage(page)}>{page.name}</button>)}<button type="button" onClick={addPage}>+ 新画布</button></nav>
  </main>
}

export default App

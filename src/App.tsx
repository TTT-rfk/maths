import { useCallback, useEffect, useRef, useState } from 'react'
import {
  constraintExpression,
  constraintValue,
  createFreeCurve,
  deformFreeCurve,
  nearestCurvePoint,
  type CurvePoint,
  type FunctionItem,
  type PointConstraint,
} from './curveEngine'
import './App.css'

type View = { x: number; y: number; scale: number }
type Mode = 'constraint' | 'freeform'
type Drag =
  | { type: 'pan'; startClientX: number; startClientY: number; startView: View }
  | { type: 'anchor'; functionId: string; anchorId: string }
  | { type: 'string'; functionId: string; index: number; startX: number; startY: number; source: CurvePoint[]; pinnedIndices: number[] }

const colors = ['#e25d3d', '#176a86', '#a34d9d', '#3f7b5d']
const transform = { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 }
const initialFunctions: FunctionItem[] = [
  { id: 'f', name: 'f', expression: 'x^2 - 2', color: colors[0], transform, anchors: [], freeCurve: null, freeAnchors: [] },
  { id: 'g', name: 'g', expression: 'sin(x)', color: colors[1], transform, anchors: [], freeCurve: null, freeAnchors: [] },
]

const expressionHelp = '支持: + - * / ^ ( ) | sin cos tan | sqrt abs | exp log | pi e'

function format(value: number) {
  return Number(value.toFixed(2)).toString()
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const longPressRef = useRef<number | null>(null)
  const pressPointRef = useRef<{ x: number; y: number } | null>(null)
  const pendingTouchStringRef = useRef<Extract<Drag, { type: 'string' }> | null>(null)
  const [functions, setFunctions] = useState(initialFunctions)
  const [selectedId, setSelectedId] = useState('f')
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 54 })
  const [mode, setMode] = useState<Mode>('constraint')
  const [selectedPoint, setSelectedPoint] = useState<{ functionId: string; pointId: string } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [notice, setNotice] = useState('约束模式：双击曲线或触屏长按创建白点，只有拖动白点才会改变函数。')

  const selected = functions.find((item) => item.id === selectedId)
  const selectedPointAvailable = Boolean(selected && selectedPoint?.functionId === selected.id && (mode === 'constraint'
    ? selected.anchors.some((anchor) => anchor.id === selectedPoint.pointId)
    : selected.freeAnchors.some((anchor) => anchor.id === selectedPoint.pointId)))

  function toGraphPoint(clientX: number, clientY: number) {
    const host = hostRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    const originX = rect.width / 2 + view.x
    const originY = rect.height / 2 + view.y
    return { x: (clientX - rect.left - originX) / view.scale, y: (originY - (clientY - rect.top)) / view.scale }
  }

  function curveFor(item: FunctionItem) {
    return item.freeCurve ?? createFreeCurve(item)
  }

  function hitFunction(clientX: number, clientY: number) {
    const point = toGraphPoint(clientX, clientY)
    if (!point) return null
    let closest: { item: FunctionItem; distance: number; freeIndex?: number } | null = null
    for (const item of functions) {
      if (mode === 'freeform') {
        const hit = nearestCurvePoint(curveFor(item), point.x, point.y, view.scale)
        if (hit && (!closest || hit.distance < closest.distance)) closest = { item, distance: hit.distance, freeIndex: hit.index }
      } else {
        const distance = Math.abs(constraintValue(item, point.x) - point.y) * view.scale
        if (distance <= 16 && (!closest || distance < closest.distance)) closest = { item, distance }
      }
    }
    return closest
  }

  function hitAnchor(clientX: number, clientY: number) {
    if (mode !== 'constraint') return null
    const point = toGraphPoint(clientX, clientY)
    if (!point) return null
    const item = functions.find((candidate) => candidate.id === selectedId)
    if (!item) return null
    for (const anchor of item.anchors) {
      if (Math.hypot(anchor.x - point.x, anchor.y - point.y) * view.scale <= 18) return { item, anchor }
    }
    return null
  }

  function hitFreeAnchor(clientX: number, clientY: number) {
    if (mode !== 'freeform') return null
    const point = toGraphPoint(clientX, clientY)
    const item = functions.find((candidate) => candidate.id === selectedId)
    if (!point || !item) return null
    const curve = curveFor(item)
    for (const anchor of item.freeAnchors) {
      const curvePoint = curve[anchor.index]
      if (curvePoint && Math.hypot(curvePoint.x - point.x, curvePoint.y - point.y) * view.scale <= 18) return { item, anchor, curvePoint }
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
      if (mode === 'freeform') {
        let previousSegment = -1
        for (const point of curveFor(item)) {
          const px = originX + point.x * view.scale
          const py = originY - point.y * view.scale
          if (!Number.isFinite(py) || Math.abs(py - originY) > height * 4) { started = false; continue }
          if (point.segment !== previousSegment) started = false
          if (!started) { context.moveTo(px, py); started = true } else context.lineTo(px, py)
          previousSegment = point.segment
        }
      } else {
        for (let px = 0; px <= width; px += 1.5) {
          const x = (px - originX) / view.scale
          const py = originY - constraintValue(item, x) * view.scale
          if (!Number.isFinite(py) || Math.abs(py - originY) > height * 4) { started = false; continue }
          if (!started) { context.moveTo(px, py); started = true } else context.lineTo(px, py)
        }
      }
      context.stroke(); context.globalAlpha = 1
      if (mode === 'constraint' && active) for (const anchor of item.anchors) {
        context.beginPath(); context.fillStyle = '#fffdf8'; context.strokeStyle = item.color; context.lineWidth = 2
        context.arc(originX + anchor.x * view.scale, originY - anchor.y * view.scale, 7, 0, Math.PI * 2); context.fill(); context.stroke()
      }
      if (mode === 'freeform' && active) for (const anchor of item.freeAnchors) {
        const point = curveFor(item)[anchor.index]
        if (!point) continue
        context.beginPath(); context.fillStyle = '#fffdf8'; context.strokeStyle = item.color; context.lineWidth = 2
        context.arc(originX + point.x * view.scale, originY - point.y * view.scale, 7, 0, Math.PI * 2); context.fill(); context.stroke()
      }
    }
  }, [functions, mode, selectedId, view])

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

  function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke()
  }

  function createAnchor(clientX: number, clientY: number) {
    const point = toGraphPoint(clientX, clientY)
    const hit = hitFunction(clientX, clientY)
    if (!point || !hit) return
    if (mode === 'freeform') {
      if (hit.freeIndex === undefined || hit.item.freeAnchors.some((anchor) => Math.abs(anchor.index - hit.freeIndex!) < 8)) return
      const anchor = { id: `free-anchor-${Date.now()}`, index: hit.freeIndex }
      setFunctions((items) => items.map((item) => item.id === hit.item.id ? { ...item, freeAnchors: [...item.freeAnchors, anchor] } : item))
      setSelectedPoint({ functionId: hit.item.id, pointId: anchor.id })
      setSelectedId(hit.item.id); setNotice('棉线固定点已创建。拖动白点可塑形，其他白点保持固定。')
      return
    }
    const anchor: PointConstraint = { id: `anchor-${Date.now()}`, x: point.x, y: constraintValue(hit.item, point.x) }
    setFunctions((items) => items.map((item) => item.id === hit.item.id ? { ...item, anchors: [...item.anchors, anchor], freeCurve: null } : item))
    setSelectedPoint({ functionId: hit.item.id, pointId: anchor.id })
    setSelectedId(hit.item.id); setNotice('白点已创建并严格附着于数学曲线。拖动白点可改变函数。')
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer tests and some embedded browsers do not expose an active pointer.
    }
    pressPointRef.current = { x: event.clientX, y: event.clientY }
    const freeAnchorHit = hitFreeAnchor(event.clientX, event.clientY)
    if (freeAnchorHit) {
      const source = curveFor(freeAnchorHit.item)
      setDrag({ type: 'string', functionId: freeAnchorHit.item.id, index: freeAnchorHit.anchor.index, startX: freeAnchorHit.curvePoint.x, startY: freeAnchorHit.curvePoint.y, source, pinnedIndices: freeAnchorHit.item.freeAnchors.filter((anchor) => anchor.id !== freeAnchorHit.anchor.id).map((anchor) => anchor.index) })
      setSelectedPoint({ functionId: freeAnchorHit.item.id, pointId: freeAnchorHit.anchor.id })
      return
    }
    const anchorHit = hitAnchor(event.clientX, event.clientY)
    if (anchorHit) {
      setSelectedId(anchorHit.item.id); setSelectedPoint({ functionId: anchorHit.item.id, pointId: anchorHit.anchor.id }); setDrag({ type: 'anchor', functionId: anchorHit.item.id, anchorId: anchorHit.anchor.id }); return
    }
    const hit = hitFunction(event.clientX, event.clientY)
    if (event.pointerType !== 'mouse' && hit) {
      if (mode === 'freeform' && hit.freeIndex !== undefined) {
        const point = toGraphPoint(event.clientX, event.clientY)!
        pendingTouchStringRef.current = { type: 'string', functionId: hit.item.id, index: hit.freeIndex, startX: point.x, startY: point.y, source: curveFor(hit.item), pinnedIndices: hit.item.freeAnchors.map((anchor) => anchor.index) }
      }
      longPressRef.current = window.setTimeout(() => { pendingTouchStringRef.current = null; createAnchor(event.clientX, event.clientY) }, 550)
      setSelectedId(hit.item.id)
      return
    }
    if (mode === 'freeform' && hit && hit.freeIndex !== undefined) {
      const point = toGraphPoint(event.clientX, event.clientY)!
      const source = curveFor(hit.item)
      setSelectedId(hit.item.id); setDrag({ type: 'string', functionId: hit.item.id, index: hit.freeIndex, startX: point.x, startY: point.y, source, pinnedIndices: hit.item.freeAnchors.map((anchor) => anchor.index) })
      setNotice('自由棉线模式：位移会沿曲线自然衰减，数学表达式保持不变。'); return
    }
    if (hit) { setSelectedId(hit.item.id); setNotice('约束模式中，直接拖曲线不会修改函数；请拖白点。'); return }
    setDrag({ type: 'pan', startClientX: event.clientX, startClientY: event.clientY, startView: view })
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (longPressRef.current && pressPointRef.current && Math.hypot(event.clientX - pressPointRef.current.x, event.clientY - pressPointRef.current.y) > 8) {
      window.clearTimeout(longPressRef.current); longPressRef.current = null
      if (pendingTouchStringRef.current) {
        const nextDrag = pendingTouchStringRef.current
        pendingTouchStringRef.current = null
        const point = toGraphPoint(event.clientX, event.clientY)
        if (point) {
          setDrag(nextDrag)
          setNotice('正在从当前棉线形状继续拖拽。')
          setFunctions((items) => items.map((item) => item.id === nextDrag.functionId ? { ...item, freeCurve: deformFreeCurve(nextDrag.source, nextDrag.index, point.x - nextDrag.startX, point.y - nextDrag.startY, nextDrag.pinnedIndices) } : item))
        }
        return
      }
    }
    if (!drag) return
    if (drag.type === 'pan') {
      setView({ ...drag.startView, x: drag.startView.x + event.clientX - drag.startClientX, y: drag.startView.y + event.clientY - drag.startClientY }); return
    }
    const point = toGraphPoint(event.clientX, event.clientY)
    if (!point) return
    if (drag.type === 'anchor') {
      setFunctions((items) => items.map((item) => {
        if (item.id !== drag.functionId) return item
        const moving = item.anchors.find((anchor) => anchor.id === drag.anchorId)
        if (!moving) return item
        let nextX = point.x
        for (const anchor of item.anchors) {
          if (anchor.id === drag.anchorId || Math.abs(nextX - anchor.x) >= 0.08) continue
          nextX = anchor.x + (moving.x <= anchor.x ? -0.08 : 0.08)
        }
        return { ...item, anchors: item.anchors.map((anchor) => anchor.id === drag.anchorId ? { ...anchor, x: nextX, y: point.y } : anchor), freeCurve: null }
      })); return
    }
    setFunctions((items) => items.map((item) => item.id === drag.functionId ? { ...item, freeCurve: deformFreeCurve(drag.source, drag.index, point.x - drag.startX, point.y - drag.startY, drag.pinnedIndices) } : item))
  }

  function endPointer() {
    if (longPressRef.current) window.clearTimeout(longPressRef.current)
    longPressRef.current = null; pressPointRef.current = null; pendingTouchStringRef.current = null; setDrag(null)
  }

  function switchMode(next: Mode) {
    setMode(next)
    setSelectedPoint(null)
    if (next === 'freeform') {
      const rect = hostRef.current?.getBoundingClientRect()
      const minX = rect ? (-rect.width / 2 - view.x) / view.scale - 20 : -20
      const maxX = rect ? (rect.width / 2 - view.x) / view.scale + 20 : 20
      setFunctions((items) => items.map((item) => !item.freeCurve ? { ...item, freeCurve: createFreeCurve(item, minX, maxX) } : item))
      setNotice('自由棉线模式：直接拖曲线；白点不显示、不参与命中，表达式不变。')
    } else setNotice('约束模式：只有白点可以改变数学函数；直接拖曲线不会修改。')
  }

  function deleteSelectedPoint() {
    if (!selectedPointAvailable || !selectedPoint) return
    setFunctions((items) => items.map((item) => item.id !== selectedPoint.functionId ? item : mode === 'constraint'
      ? { ...item, anchors: item.anchors.filter((anchor) => anchor.id !== selectedPoint.pointId), freeCurve: null }
      : { ...item, freeAnchors: item.freeAnchors.filter((anchor) => anchor.id !== selectedPoint.pointId) }))
    setSelectedPoint(null)
    setNotice('已删除选中的白点。')
  }

  function addFunction() {
    const index = functions.length
    const next: FunctionItem = { id: `f${Date.now()}`, name: String.fromCharCode(102 + index), expression: 'x', color: colors[index % colors.length], transform: { ...transform }, anchors: [], freeCurve: null, freeAnchors: [] }
    setFunctions([...functions, next]); setSelectedId(next.id)
  }

  function addDerivative() {
    if (!selected) return
    const item: FunctionItem = { id: `d${Date.now()}`, name: `${selected.name}'`, expression: selected.expression, color: colors[functions.length % colors.length], transform: { ...selected.transform }, derivative: true, anchors: [], freeCurve: null, freeAnchors: [] }
    setFunctions([...functions, item]); setSelectedId(item.id)
  }

  return <main className="app-shell">
    <header className="topbar"><div><span className="brand-mark">ƒ</span><strong>函数画布</strong><span className="subtitle">图形即操作</span></div><div className="topbar-actions"><button type="button" onClick={() => setView({ x: 0, y: 0, scale: 54 })}>重置视图</button><button className="primary" type="button" onClick={addFunction}>+ 新函数</button></div></header>
    <section className="workspace">
      <aside className="function-panel" aria-label="函数列表"><div className="panel-heading"><span>表达式</span><span>{functions.length} 个对象</span></div><div className="function-list">{functions.map((item) => <article className={`function-card ${item.id === selectedId ? 'selected' : ''}`} key={item.id}><button className="function-select" type="button" onClick={() => setSelectedId(item.id)}><span style={{ background: item.color }} /><b>{item.name}</b></button><label htmlFor={`expression-${item.id}`}>{item.name}(x) =</label><input id={`expression-${item.id}`} value={item.expression} onChange={(event) => setFunctions((items) => items.map((value) => value.id === item.id ? { ...value, expression: event.target.value, anchors: [], freeCurve: null, freeAnchors: [] } : value))} spellCheck="false" /></article>)}</div><p className="expression-help">{expressionHelp}</p></aside>
      <section className="canvas-area" aria-label="函数图像画布"><div className="canvas-mode-switch"><button className={mode === 'constraint' ? 'active' : ''} type="button" onClick={() => switchMode('constraint')}>1 约束</button><button className={mode === 'freeform' ? 'active' : ''} type="button" onClick={() => switchMode('freeform')}>3 棉线</button><button type="button" disabled={!selectedPointAvailable} onClick={deleteSelectedPoint}>删除点</button></div><div className="canvas-host" ref={hostRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={endPointer} onPointerCancel={endPointer} onDoubleClick={(event) => { if (!hitAnchor(event.clientX, event.clientY)) createAnchor(event.clientX, event.clientY) }}><canvas ref={canvasRef} /><p className="canvas-note">{notice}</p></div><div className="floating-toolbar"><button type="button" disabled={!selected} onClick={addDerivative}>求导</button><button type="button" disabled>组合</button><button type="button" disabled>分析</button></div></section>
      <aside className="inspector" aria-label="所选函数属性"><p className="eyebrow">当前对象</p>{selected ? <><h1>{selected.name}(x)</h1><p className="expression-large">{mode === 'constraint' ? constraintExpression(selected, format) : `${selected.expression}（仅自由曲线显示）`}</p><div className="rule" /><p className="eyebrow">拖拽模式</p><div className="mode-switch"><button className={mode === 'constraint' ? 'active' : ''} type="button" onClick={() => switchMode('constraint')}>1 数学约束</button><button className={mode === 'freeform' ? 'active' : ''} type="button" onClick={() => switchMode('freeform')}>3 自由棉线</button></div>{mode === 'constraint' ? <><p className="hint">双击曲线或触屏长按创建白点。只有白点能改变数学图像。</p><p className="eyebrow">经过点</p><div className="anchor-list">{selected.anchors.length ? selected.anchors.map((anchor, index) => <div key={anchor.id}><span>点 {index + 1}: ({format(anchor.x)}, {format(anchor.y)})</span><button type="button" onClick={() => setFunctions((items) => items.map((item) => item.id === selected.id ? { ...item, anchors: item.anchors.filter((entry) => entry.id !== anchor.id), freeCurve: null } : item))}>删除</button></div>) : <p>暂无白点</p>}</div></> : <><p className="hint">双击曲线或触屏长按创建棉线固定点。每次拖拽都在当前形状上继续变化。</p><p className="eyebrow">棉线固定点</p><div className="anchor-list">{selected.freeAnchors.length ? selected.freeAnchors.map((anchor, index) => <div key={anchor.id}><span>点 {index + 1}</span><button type="button" onClick={() => setFunctions((items) => items.map((item) => item.id === selected.id ? { ...item, freeAnchors: item.freeAnchors.filter((entry) => entry.id !== anchor.id) } : item))}>删除</button></div>) : <p>暂无白点</p>}</div><button className="clear-edits" type="button" onClick={() => setFunctions((items) => items.map((item) => item.id === selected.id ? { ...item, freeCurve: createFreeCurve({ ...item, freeCurve: null }), freeAnchors: [] } : item))}>恢复原函数形状</button></>}</> : <p>选择一条函数。</p>}</aside>
    </section>
  </main>
}

export default App

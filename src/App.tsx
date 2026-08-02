import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

type Transform = { horizontal: number; vertical: number; xScale: number; yScale: number }
type FunctionItem = { id: string; name: string; expression: string; color: string; transform: Transform; derivative?: boolean }
type View = { x: number; y: number; scale: number }

const colors = ['#e25d3d', '#176a86', '#a34d9d', '#3f7b5d']
const initialFunctions: FunctionItem[] = [
  { id: 'f', name: 'f', expression: 'x^2 - 2', color: colors[0], transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 } },
  { id: 'g', name: 'g', expression: 'sin(x)', color: colors[1], transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 } },
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
  return vertical === 0 ? scaled : `${scaled} ${vertical > 0 ? '+' : '-'} ${format(Math.abs(vertical))}`
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

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [functions, setFunctions] = useState(initialFunctions)
  const [selectedIds, setSelectedIds] = useState<string[]>(['f'])
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 54 })
  const [notice, setNotice] = useState('选择曲线后，拖动控制柄来变换它。')
  const [drag, setDrag] = useState<{ mode: 'pan' | 'move' | 'scale'; startX: number; startY: number; view: View; transform?: Transform } | null>(null)

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
        const input = item.transform.xScale * (x - item.transform.horizontal)
        const rawY = item.derivative ? derivative(item.expression)(input) : evaluate(item.expression, input)
        const y = item.transform.yScale * rawY + item.transform.vertical
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

  function updatePrimary(update: (item: FunctionItem) => FunctionItem) {
    if (!primary) return
    setFunctions((current) => current.map((item) => item.id === primary.id ? update(item) : item))
  }

  function beginDrag(event: React.PointerEvent<HTMLElement>, mode: 'pan' | 'move' | 'scale') {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ mode, startX: event.clientX, startY: event.clientY, view, transform: primary?.transform })
  }

  function movePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.mode === 'pan') setView({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy })
    if (drag.mode === 'move' && drag.transform) {
      updatePrimary((item) => ({ ...item, transform: { ...drag.transform!, horizontal: drag.transform!.horizontal + dx / view.scale, vertical: drag.transform!.vertical - dy / view.scale } }))
    }
    if (drag.mode === 'scale' && drag.transform) {
      const factor = Math.max(0.2, Math.min(5, 1 + (dx - dy) / 250))
      updatePrimary((item) => ({ ...item, transform: { ...drag.transform!, xScale: drag.transform!.xScale * factor, yScale: drag.transform!.yScale * factor } }))
    }
  }

  function addFunction() {
    const index = functions.length
    const next = { id: `f${Date.now()}`, name: String.fromCharCode(102 + index), expression: 'x', color: colors[index % colors.length], transform: { horizontal: 0, vertical: 0, xScale: 1, yScale: 1 } }
    setFunctions([...functions, next])
    setSelectedIds([next.id])
    setNotice('已添加新函数。直接在左侧修改表达式。')
  }

  function addDerivative() {
    if (!primary) return
    const derivativeItem: FunctionItem = { id: `d${Date.now()}`, name: `${primary.name}'`, expression: primary.expression, color: colors[functions.length % colors.length], transform: primary.transform, derivative: true }
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
        <div className="canvas-host" ref={hostRef} onPointerDown={(event) => beginDrag(event, 'pan')} onPointerMove={movePointer} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
          <canvas ref={canvasRef} />
          {primary && <div className="transform-hud" onPointerDown={(event) => event.stopPropagation()}>
            <span className="hud-label">已选 {primary.name}(x)</span>
            <button type="button" onPointerDown={(event) => beginDrag(event, 'move')} aria-label="拖动以平移函数">移动 <i>↕</i></button>
            <button type="button" onPointerDown={(event) => beginDrag(event, 'scale')} aria-label="拖动以缩放函数">缩放 <i>⤢</i></button>
          </div>}
          <p className="canvas-note">{notice}</p>
        </div>
        <div className="floating-toolbar" aria-label="函数操作">
          <button type="button" disabled={!primary} onClick={addDerivative}>求导</button>
          <button type="button" disabled={selected.length !== 2} onClick={() => setNotice('函数组合将在下一步接入符号运算引擎。')}>组合</button>
          <button type="button" disabled={!primary} onClick={() => setNotice('请选择“移动”或“缩放”控制柄，变换会反映到公式。')}>变换</button>
          <button type="button" disabled={!primary} onClick={() => setNotice('分析功能将在符号引擎接入后提供。')}>分析</button>
        </div>
      </section>

      <aside className="inspector" aria-label="所选函数属性">
        <p className="eyebrow">当前对象</p>
        {primary ? <><h1>{primary.name}(x)</h1><p className="expression-large">{primary.expression}</p><div className="rule" /><p className="eyebrow">图形变换</p><dl><dt>水平平移</dt><dd>{format(primary.transform.horizontal)}</dd><dt>垂直平移</dt><dd>{format(primary.transform.vertical)}</dd><dt>水平缩放</dt><dd>{format(primary.transform.xScale)}</dd><dt>垂直缩放</dt><dd>{format(primary.transform.yScale)}</dd></dl><p className="hint">在画布内拖动“移动”或“缩放”控制柄，所有数值都会即时更新。</p></> : <p>选择一条函数查看属性。</p>}
      </aside>
    </section>
  </main>
}

export default App

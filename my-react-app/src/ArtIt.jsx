import { useEffect, useRef, useState } from "react"
import brushIcon from "./assets/Pbrush.png"
import bucketIcon from "./assets/Pbucket.png"
import eraserIcon from "./assets/Peraser.png"

const defaultColors = [
  "#111827",
  "#ffffff",
  "#dc2626",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#2563eb",
  "#7c3aed",
  "#ec4899",
  "#6b7280",
]
const tools = [
  { id: "pen", label: "Pen", icon: brushIcon },
  { id: "eraser", label: "Eraser", icon: eraserIcon },
  { id: "fill", label: "Bucket", icon: bucketIcon },
  { id: "select", label: "Highlight + Drag", icon: null },
]
const canvasPresets = [
  { id: "800x600", label: "800 x 600", width: 800, height: 600 },
  { id: "1200x760", label: "1200 x 760", width: 1200, height: 760 },
  { id: "1920x1080", label: "1920 x 1080", width: 1920, height: 1080 },
]
const pixelPresets = [
  { id: "16", label: "16 x 16", cells: 16 },
  { id: "32", label: "32 x 32", cells: 32 },
  { id: "64", label: "64 x 64", cells: 64 },
  { id: "128", label: "128 x 128", cells: 128 },
]
const exportScales = [1, 2, 3, 4, 8]
const pixelDisplaySize = 640

function ArtIt({
  folders = [],
  defaultFolderId = "desktop",
  onExport,
}) {
  const canvasRef = useRef(null)
  const pixelGridRef = useRef(makePixelGrid(64))
  const dragRef = useRef(null)
  const snapshotRef = useRef(null)
  const undoStackRef = useRef([])
  const redoStackRef = useRef([])
  const [mode, setMode] = useState(null)
  const [draftMode, setDraftMode] = useState("canvas")
  const [draftCanvasSize, setDraftCanvasSize] = useState(canvasPresets[1].id)
  const [draftPixelSize, setDraftPixelSize] = useState(pixelPresets[2].id)
  const [artSize, setArtSize] = useState(canvasPresets[1])
  const [pixelCells, setPixelCells] = useState(64)
  const [tool, setTool] = useState("pen")
  const [eraserActive, setEraserActive] = useState(false)
  const [color, setColor] = useState("#2563eb")
  const [usedColors, setUsedColors] = useState([])
  const [selection, setSelection] = useState(null)
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportScale, setExportScale] = useState(1)
  const [exportName, setExportName] = useState("Art It!")
  const [exportFolderId, setExportFolderId] = useState(defaultFolderId)
  const [exportFileHandle, setExportFileHandle] = useState(null)
  const [exportFileName, setExportFileName] = useState("")
  const [renderTick, setRenderTick] = useState(0)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const usesInventoryExport = typeof onExport === "function"

  useEffect(() => {
    if (!mode) return

    const canvas = canvasRef.current
    const context = canvas.getContext("2d", { willReadFrequently: true })

    if (mode === "canvas" && !canvas.dataset.ready) {
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      canvas.dataset.ready = "true"
    }

    if (mode === "pixel") drawPixelCanvas(canvas, pixelGridRef.current, selection, pixelCells)
  }, [mode, pixelCells, renderTick, selection])

  function startArtIt(nextMode, sizeId) {
    const canvasPreset = getCanvasPreset(sizeId)
    const pixelPreset = getPixelPreset(sizeId)

    setMode(nextMode)
    setArtSize(nextMode === "pixel" ? { width: pixelPreset.cells, height: pixelPreset.cells } : canvasPreset)
    setPixelCells(pixelPreset.cells)
    setSelection(null)
    requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = nextMode === "pixel" ? pixelDisplaySize : canvasPreset.width
      canvas.height = nextMode === "pixel" ? pixelDisplaySize : canvasPreset.height
      delete canvas.dataset.ready

      if (nextMode === "pixel") {
        pixelGridRef.current = makePixelGrid(pixelPreset.cells)
      }

      undoStackRef.current = [
        captureSnapshot(nextMode, canvas, pixelGridRef.current, {
          artSize:
            nextMode === "pixel"
              ? { width: pixelPreset.cells, height: pixelPreset.cells }
              : canvasPreset,
          pixelCells: pixelPreset.cells,
        }),
      ]
      redoStackRef.current = []
      updateHistoryState()
      setRenderTick((tick) => tick + 1)
    })
  }

  function resizeArtwork(sizeId) {
    const canvas = canvasRef.current
    if (!canvas) return

    setSelection(null)
    setSizeMenuOpen(false)

    if (mode === "canvas") {
      const previousSnapshot = captureSnapshot(mode, canvas, pixelGridRef.current)
      const nextSize = getCanvasPreset(sizeId)
      const oldCanvas = document.createElement("canvas")
      oldCanvas.width = canvas.width
      oldCanvas.height = canvas.height
      oldCanvas.getContext("2d").drawImage(canvas, 0, 0)

      canvas.width = nextSize.width
      canvas.height = nextSize.height
      const context = canvas.getContext("2d", { willReadFrequently: true })
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(oldCanvas, 0, 0, canvas.width, canvas.height)
      canvas.dataset.ready = "true"
      setArtSize(nextSize)
      pushHistoryWithPrevious(previousSnapshot, {
        mode,
        artSize: nextSize,
        pixelCells,
      })
      return
    }

    const previousSnapshot = captureSnapshot(mode, canvas, pixelGridRef.current)
    const nextPreset = getPixelPreset(sizeId)
    pixelGridRef.current = resizePixelGrid(pixelGridRef.current, nextPreset.cells)
    canvas.width = pixelDisplaySize
    canvas.height = pixelDisplaySize
    setPixelCells(nextPreset.cells)
    setArtSize({ width: nextPreset.cells, height: nextPreset.cells })
    pushHistoryWithPrevious(previousSnapshot, {
      mode,
      artSize: { width: nextPreset.cells, height: nextPreset.cells },
      pixelCells: nextPreset.cells,
    })
    setRenderTick((tick) => tick + 1)
  }

  async function chooseExportFile() {
    if (!window.showSaveFilePicker) {
      setExportFileHandle(null)
      setExportFileName("Browser download")
      return
    }

    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: safePngName(exportName),
        types: [
          {
            description: "PNG image",
            accept: { "image/png": [".png"] },
          },
        ],
      })

      setExportFileHandle(handle)
      setExportFileName(handle.name)
    } catch (error) {
      if (error.name !== "AbortError") throw error
    }
  }

  async function exportPng() {
    const canvas = canvasRef.current
    if (!canvas) return

    const scale = Number(exportScale) || 1
    const output = document.createElement("canvas")

    if (mode === "pixel") {
      output.width = pixelCells * scale
      output.height = pixelCells * scale
      drawPixelExport(output, pixelGridRef.current, pixelCells)
    } else {
      output.width = canvas.width * scale
      output.height = canvas.height * scale
      const context = output.getContext("2d")
      context.imageSmoothingEnabled = true
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, output.width, output.height)
      context.drawImage(canvas, 0, 0, output.width, output.height)
    }

    if (usesInventoryExport) {
      onExport({
        name: exportName,
        folderId: exportFolderId,
        dataUrl: output.toDataURL("image/png"),
        width: output.width,
        height: output.height,
      })
      setExportDialogOpen(false)
      return
    }

    const blob = await canvasToBlob(output)
    const handle = exportFileHandle ?? (await requestSaveFile(exportName))
    if (handle === undefined) return

    if (handle !== null) {
      await writeBlobToHandle(handle, blob)
      setExportFileHandle(handle)
      setExportFileName(handle.name)
    } else {
      downloadBlob(blob, safePngName(exportName))
    }

    setExportDialogOpen(false)
  }

  function chooseColor(nextColor) {
    setColor(nextColor)
    setUsedColors((colors) =>
      colors.includes(nextColor) ? colors : [nextColor, ...colors].slice(0, 18),
    )
  }

  function startPointer(e) {
    if (!mode) return

    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)

    const canvas = canvasRef.current
    const point = getCanvasPoint(canvas, e)

    if (tool === "pen" || tool === "fill" || (tool === "select" && selection)) {
      pushHistory()
    }

    if (mode === "pixel") {
      startPixelPointer(point)
      return
    }

    startCanvasPointer(point)
  }

  function movePointer(e) {
    const drag = dragRef.current
    if (!drag || !mode) return

    e.preventDefault()
    const point = getCanvasPoint(canvasRef.current, e)

    if (mode === "pixel") {
      movePixelPointer(point)
      return
    }

    moveCanvasPointer(point)
  }

  function finishPointer(e) {
    const drag = dragRef.current
    if (!drag) return

    e.preventDefault()

    if (mode === "pixel") finishPixelPointer()
    if (mode === "canvas") finishCanvasPointer()

    if (drag?.type === "draw" || drag?.type === "move-selection") {
      pushHistory()
    }

    dragRef.current = null
    snapshotRef.current = null
  }

  function pushHistory() {
    const canvas = canvasRef.current
    if (!mode || !canvas) return

    const snapshot = captureSnapshot(mode, canvas, pixelGridRef.current)
    const last = undoStackRef.current.at(-1)

    if (last && snapshotsMatch(last, snapshot)) return

    undoStackRef.current = [...undoStackRef.current, snapshot].slice(-80)
    redoStackRef.current = []
    updateHistoryState()
  }

  function pushHistoryWithPrevious(previousSnapshot, override = {}) {
    const canvas = canvasRef.current
    if (!mode || !canvas) return

    const nextSnapshot = captureSnapshot(
      override.mode ?? mode,
      canvas,
      pixelGridRef.current,
      {
        artSize: override.artSize,
        pixelCells: override.pixelCells,
      },
    )
    const stack = undoStackRef.current
    const withoutDuplicatePrevious =
      stack.at(-1) && snapshotsMatch(stack.at(-1), previousSnapshot)
        ? stack
        : [...stack, previousSnapshot]

    undoStackRef.current = [...withoutDuplicatePrevious, nextSnapshot].slice(-80)
    redoStackRef.current = []
    updateHistoryState()
  }

  function undo() {
    if (undoStackRef.current.length <= 1) return

    const current = undoStackRef.current.at(-1)
    const previous = undoStackRef.current.at(-2)

    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, current]
    restoreSnapshot(previous)
    updateHistoryState()
  }

  function redo() {
    const snapshot = redoStackRef.current.at(-1)
    if (!snapshot) return

    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current, snapshot]
    restoreSnapshot(snapshot)
    updateHistoryState()
  }

  function restoreSnapshot(snapshot) {
    const canvas = canvasRef.current
    if (!canvas || !snapshot) return

    setSelection(null)
    setMode(snapshot.mode)
    setArtSize(snapshot.artSize)
    setPixelCells(snapshot.pixelCells)

    requestAnimationFrame(() => {
      canvas.width = snapshot.mode === "pixel" ? pixelDisplaySize : snapshot.artSize.width
      canvas.height = snapshot.mode === "pixel" ? pixelDisplaySize : snapshot.artSize.height

      if (snapshot.mode === "pixel") {
        pixelGridRef.current = cloneGrid(snapshot.pixelGrid)
        setRenderTick((tick) => tick + 1)
        return
      }

      const context = canvas.getContext("2d", { willReadFrequently: true })
      const image = new Image()
      image.onload = () => {
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0)
        canvas.dataset.ready = "true"
      }
      image.src = snapshot.dataUrl
    })
  }

  function handleKeys(event) {
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() !== "z") return

      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }

    if (isTypingTarget(event.target)) return

    const key = event.key.toLowerCase()
    if (key === "p") {
      event.preventDefault()
      chooseTool("pen", setTool, setEraserActive)
    }
    if (key === "b") {
      event.preventDefault()
      chooseTool("fill", setTool, setEraserActive)
    }
    if (key === "e") {
      event.preventDefault()
      chooseTool("eraser", setTool, setEraserActive)
    }
    if (key === "s") {
      event.preventDefault()
      chooseTool("select", setTool, setEraserActive)
    }
  }

  function updateHistoryState() {
    setHistoryState({
      canUndo: undoStackRef.current.length > 1,
      canRedo: redoStackRef.current.length > 0,
    })
  }

  useEffect(() => {
    if (!mode) return

    window.addEventListener("keydown", handleKeys)
    return () => window.removeEventListener("keydown", handleKeys)
  })

  function startCanvasPointer(point) {
    const canvas = canvasRef.current
    const context = canvas.getContext("2d", { willReadFrequently: true })

    if (tool === "fill") {
      floodFillCanvas(context, point, eraserActive ? "#ffffff" : color)
      if (!eraserActive) chooseColor(color)
      setSelection(null)
      setRenderTick((tick) => tick + 1)
      return
    }

    if (tool === "select") {
      if (selection && pointInRect(point, selection)) {
        const image = context.getImageData(
          selection.x,
          selection.y,
          selection.width,
          selection.height,
        )
        context.clearRect(selection.x, selection.y, selection.width, selection.height)
        context.fillStyle = "#ffffff"
        context.fillRect(selection.x, selection.y, selection.width, selection.height)
        snapshotRef.current = context.getImageData(0, 0, canvas.width, canvas.height)
        dragRef.current = {
          type: "move-selection",
          start: point,
          origin: selection,
          image,
        }
        return
      }

      dragRef.current = { type: "select", start: point }
      setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
      return
    }

    setSelection(null)
    dragRef.current = { type: "draw", last: point }
    drawCanvasStroke(context, point, point, eraserActive, color)
    if (!eraserActive) chooseColor(color)
  }

  function moveCanvasPointer(point) {
    const canvas = canvasRef.current
    const context = canvas.getContext("2d", { willReadFrequently: true })
    const drag = dragRef.current

    if (drag.type === "draw") {
      drawCanvasStroke(context, drag.last, point, eraserActive, color)
      drag.last = point
      return
    }

    if (drag.type === "select") {
      setSelection(normalizeRect(drag.start, point, canvas.width, canvas.height))
      return
    }

    if (drag.type === "move-selection") {
      context.putImageData(snapshotRef.current, 0, 0)
      const x = clamp(
        Math.round(drag.origin.x + point.x - drag.start.x),
        0,
        canvas.width - drag.origin.width,
      )
      const y = clamp(
        Math.round(drag.origin.y + point.y - drag.start.y),
        0,
        canvas.height - drag.origin.height,
      )
      context.putImageData(drag.image, x, y)
      setSelection({ ...drag.origin, x, y })
    }
  }

  function finishCanvasPointer() {
    const drag = dragRef.current
    if (drag?.type === "select" && selection && (selection.width < 3 || selection.height < 3)) {
      setSelection(null)
    }
  }

  function startPixelPointer(point) {
    const cell = getCell(point, pixelCells)

    if (tool === "fill") {
      floodFillPixel(
        pixelGridRef.current,
        cell,
        eraserActive ? "" : color,
        pixelCells,
      )
      if (!eraserActive) chooseColor(color)
      setSelection(null)
      setRenderTick((tick) => tick + 1)
      return
    }

    if (tool === "select") {
      if (selection && pointInRect(cell, selection)) {
        const pixels = copyPixelSelection(pixelGridRef.current, selection)
        clearPixelSelection(pixelGridRef.current, selection)
        dragRef.current = {
          type: "move-selection",
          start: cell,
          origin: selection,
          pixels,
        }
        setRenderTick((tick) => tick + 1)
        return
      }

      dragRef.current = { type: "select", start: cell }
      setSelection({ x: cell.x, y: cell.y, width: 1, height: 1 })
      return
    }

    setSelection(null)
    dragRef.current = { type: "draw", last: cell }
    drawPixelLine(pixelGridRef.current, cell, cell, eraserActive ? "" : color)
    if (!eraserActive) chooseColor(color)
    setRenderTick((tick) => tick + 1)
  }

  function movePixelPointer(point) {
    const cell = getCell(point, pixelCells)
    const drag = dragRef.current

    if (drag.type === "draw") {
      drawPixelLine(pixelGridRef.current, drag.last, cell, eraserActive ? "" : color)
      drag.last = cell
      setRenderTick((tick) => tick + 1)
      return
    }

    if (drag.type === "select") {
      setSelection(normalizeRect(drag.start, cell, pixelCells, pixelCells, true))
      return
    }

    if (drag.type === "move-selection") {
      const grid = pixelGridRef.current
      pixelGridRef.current = drag.snapshot ?? cloneGrid(grid)
      if (!drag.snapshot) drag.snapshot = cloneGrid(grid)

      const x = clamp(
        Math.round(drag.origin.x + cell.x - drag.start.x),
        0,
        pixelCells - drag.origin.width,
      )
      const y = clamp(
        Math.round(drag.origin.y + cell.y - drag.start.y),
        0,
        pixelCells - drag.origin.height,
      )
      pastePixelSelection(pixelGridRef.current, drag.pixels, x, y)
      setSelection({ ...drag.origin, x, y })
      setRenderTick((tick) => tick + 1)
    }
  }

  function finishPixelPointer() {
    const drag = dragRef.current
    if (drag?.type === "select" && selection && selection.width < 1 && selection.height < 1) {
      setSelection(null)
    }
  }

  if (!mode) {
    const activeSizes = draftMode === "canvas" ? canvasPresets : pixelPresets
    const activeSize = draftMode === "canvas" ? draftCanvasSize : draftPixelSize

    return (
      <div className="drawing-app drawing-start">
        <header className="drawing-header">Art It!</header>
        <main className="drawing-start-options">
          <div className="drawing-start-cards">
            <button
              className={draftMode === "canvas" ? "drawing-start-active" : ""}
              type="button"
              onClick={() => setDraftMode("canvas")}
            >
              <span>Canvas</span>
              <small>Free drawing surface</small>
            </button>
            <button
              className={draftMode === "pixel" ? "drawing-start-active" : ""}
              type="button"
              onClick={() => setDraftMode("pixel")}
            >
              <span>Pixel</span>
              <small>Grid-based drawing surface</small>
            </button>
          </div>
          <label className="drawing-size-field">
            Size
            <select
              value={activeSize}
              onChange={(event) => {
                if (draftMode === "canvas") setDraftCanvasSize(event.target.value)
                else setDraftPixelSize(event.target.value)
              }}
            >
              {activeSizes.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="drawing-start-button"
            type="button"
            onClick={() => startArtIt(draftMode, activeSize)}
          >
            Start
          </button>
        </main>
      </div>
    )
  }

  const palette = [...new Set([...defaultColors, ...usedColors])]

  return (
    <div className="drawing-app" tabIndex={0}>
      <header className="drawing-header">
        <span>{mode === "pixel" ? "Art It! - Pixel" : "Art It! - Canvas"}</span>
        <button type="button" onClick={() => setExportDialogOpen(true)}>
          Export
        </button>
        <button type="button" onClick={() => setMode(null)}>
          New
        </button>
      </header>

      <div className="drawing-workspace">
        <aside className="drawing-toolbar">
          <div className="drawing-tool-group">
            {tools.map((item) => (
              <button
                key={item.id}
                className={
                  isToolActive(item.id, tool, eraserActive)
                    ? "drawing-tool-active"
                    : ""
                }
                type="button"
                onClick={() => chooseTool(item.id, setTool, setEraserActive)}
                title={item.label}
                aria-label={item.label}
              >
                {item.icon ? <img src={item.icon} alt="" /> : <span>▣</span>}
              </button>
            ))}
          </div>

          <div className="drawing-history-group">
            <button
              type="button"
              disabled={!historyState.canUndo}
              onClick={undo}
            >
              ↶ Undo
            </button>
            <button
              type="button"
              disabled={!historyState.canRedo}
              onClick={redo}
            >
              ↷ Redo
            </button>
          </div>

          <div className="drawing-color-panel">
            <h2>Colors</h2>
            <div className="drawing-swatches">
              {palette.map((item) => (
                <button
                  key={item}
                  className={item === color ? "drawing-swatch-active" : ""}
                  type="button"
                  style={{ backgroundColor: item }}
                  aria-label={item}
                  onClick={() => chooseColor(item)}
                />
              ))}
            </div>
            <input
              className="drawing-color-input"
              type="color"
              value={color}
              onChange={(event) => chooseColor(event.target.value)}
            />
          </div>
        </aside>

        <main className="drawing-canvas-wrap">
          <div
            className={`drawing-canvas-stage drawing-canvas-stage-${mode}`}
            style={{ aspectRatio: `${artSize.width} / ${artSize.height}` }}
          >
            <canvas
              ref={canvasRef}
              className={`drawing-canvas drawing-canvas-${mode}`}
              onPointerDown={startPointer}
              onPointerMove={movePointer}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
            />
            {mode === "canvas" && selection && (
              <div className="drawing-selection" style={selectionStyle(selection, artSize)} />
            )}
          </div>
          <div className="drawing-corner-actions">
            <button type="button" onClick={() => setSizeMenuOpen((open) => !open)}>
              Size
            </button>
            {sizeMenuOpen && (
              <div className="drawing-size-menu">
                {(mode === "canvas" ? canvasPresets : pixelPresets).map((size) => (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => resizeArtwork(size.id)}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {exportDialogOpen && (
        <div className="drawing-dialog-overlay" onPointerDown={() => setExportDialogOpen(false)}>
          <form
            className="drawing-dialog"
            onSubmit={(event) => {
              event.preventDefault()
              exportPng()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h2>Export PNG</h2>
            <label>
              Name
              <input
                value={exportName}
                onChange={(event) => setExportName(event.target.value)}
              />
            </label>
            {usesInventoryExport ? (
              <label>
                Place
                <select
                  value={exportFolderId}
                  onChange={(event) => setExportFolderId(event.target.value)}
                >
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folderPath(folders, folder.id)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Place
                <button
                  className="drawing-file-button"
                  type="button"
                  onClick={chooseExportFile}
                >
                  {exportFileName || "Choose file..."}
                </button>
              </label>
            )}
            <label>
              Scale
              <select
                value={exportScale}
                onChange={(event) => setExportScale(Number(event.target.value))}
              >
                {exportScales.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale}x
                  </option>
                ))}
              </select>
            </label>
            <div className="drawing-dialog-actions">
              <button type="button" onClick={() => setExportDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit">Export</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function chooseTool(nextTool, setTool, setEraserActive) {
  if (nextTool === "eraser") {
    setEraserActive((active) => !active)
    setTool((current) => current === "select" ? "pen" : current)
    return
  }

  setTool(nextTool)
  if (nextTool === "pen" || nextTool === "select") setEraserActive(false)
}

function isToolActive(toolId, tool, eraserActive) {
  if (toolId === "eraser") return eraserActive
  return tool === toolId
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable
  )
}

function drawCanvasStroke(context, from, to, eraserActive, color) {
  context.save()
  context.lineCap = "round"
  context.lineJoin = "round"
  context.lineWidth = eraserActive ? 28 : 7
  context.strokeStyle = eraserActive ? "#ffffff" : color
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
  context.restore()
}

function floodFillCanvas(context, point, color) {
  const width = context.canvas.width
  const height = context.canvas.height
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  const x = Math.floor(point.x)
  const y = Math.floor(point.y)
  const start = getPixel(data, width, x, y)
  const fill = hexToRgba(color)

  if (colorsMatch(start, fill)) return

  const stack = [[x, y]]
  while (stack.length) {
    const [nextX, nextY] = stack.pop()
    if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
    if (!colorsMatch(getPixel(data, width, nextX, nextY), start)) continue

    setPixel(data, width, nextX, nextY, fill)
    stack.push([nextX + 1, nextY], [nextX - 1, nextY], [nextX, nextY + 1], [nextX, nextY - 1])
  }

  context.putImageData(image, 0, 0)
}

function makePixelGrid(cells) {
  return Array.from({ length: cells }, () => Array(cells).fill(""))
}

function drawPixelCanvas(canvas, grid, selection, cells) {
  const context = canvas.getContext("2d")
  const cellSize = canvas.width / cells

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      if (!grid[y][x]) continue
      context.fillStyle = grid[y][x]
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
    }
  }

  context.strokeStyle = "rgba(31, 41, 55, 0.22)"
  context.lineWidth = 1
  for (let i = 0; i <= cells; i += 1) {
    const line = i * cellSize
    context.beginPath()
    context.moveTo(line, 0)
    context.lineTo(line, canvas.height)
    context.moveTo(0, line)
    context.lineTo(canvas.width, line)
    context.stroke()
  }

  if (selection) {
    context.save()
    context.setLineDash([6, 4])
    context.strokeStyle = "#2563eb"
    context.lineWidth = 2
    context.strokeRect(
      selection.x * cellSize + 1,
      selection.y * cellSize + 1,
      selection.width * cellSize - 2,
      selection.height * cellSize - 2,
    )
    context.restore()
  }
}

function drawPixelLine(grid, from, to, color) {
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const sx = from.x < to.x ? 1 : -1
  const sy = from.y < to.y ? 1 : -1
  let error = dx - dy
  let x = from.x
  let y = from.y

  while (true) {
    grid[y][x] = color
    if (x === to.x && y === to.y) break
    const nextError = 2 * error
    if (nextError > -dy) {
      error -= dy
      x += sx
    }
    if (nextError < dx) {
      error += dx
      y += sy
    }
  }
}

function floodFillPixel(grid, cell, color, cells) {
  const target = grid[cell.y][cell.x]
  if (target === color) return

  const stack = [cell]
  while (stack.length) {
    const next = stack.pop()
    if (next.x < 0 || next.y < 0 || next.x >= cells || next.y >= cells) continue
    if (grid[next.y][next.x] !== target) continue

    grid[next.y][next.x] = color
    stack.push(
      { x: next.x + 1, y: next.y },
      { x: next.x - 1, y: next.y },
      { x: next.x, y: next.y + 1 },
      { x: next.x, y: next.y - 1 },
    )
  }
}

function copyPixelSelection(grid, selection) {
  return Array.from({ length: selection.height }, (_, y) =>
    Array.from({ length: selection.width }, (_, x) => grid[selection.y + y][selection.x + x]),
  )
}

function clearPixelSelection(grid, selection) {
  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      grid[selection.y + y][selection.x + x] = ""
    }
  }
}

function pastePixelSelection(grid, pixels, x, y) {
  for (let row = 0; row < pixels.length; row += 1) {
    for (let col = 0; col < pixels[row].length; col += 1) {
      grid[y + row][x + col] = pixels[row][col]
    }
  }
}

function cloneGrid(grid) {
  return grid.map((row) => [...row])
}

function captureSnapshot(mode, canvas, pixelGrid, override = {}) {
  const artSize = override.artSize ?? {
    width: canvas.width,
    height: canvas.height,
  }
  const pixelCells = override.pixelCells ?? pixelGrid.length

  return {
    mode,
    artSize,
    pixelCells,
    dataUrl: mode === "canvas" ? canvas.toDataURL("image/png") : "",
    pixelGrid: mode === "pixel" ? cloneGrid(pixelGrid) : [],
  }
}

function snapshotsMatch(a, b) {
  if (!a || !b) return false
  if (a.mode !== b.mode) return false
  if (a.artSize.width !== b.artSize.width || a.artSize.height !== b.artSize.height) {
    return false
  }
  if (a.pixelCells !== b.pixelCells) return false
  if (a.mode === "canvas") return a.dataUrl === b.dataUrl

  return JSON.stringify(a.pixelGrid) === JSON.stringify(b.pixelGrid)
}

function resizePixelGrid(grid, nextCells) {
  const oldCells = grid.length
  const nextGrid = makePixelGrid(nextCells)

  for (let y = 0; y < nextCells; y += 1) {
    for (let x = 0; x < nextCells; x += 1) {
      const oldX = clamp(Math.floor((x / nextCells) * oldCells), 0, oldCells - 1)
      const oldY = clamp(Math.floor((y / nextCells) * oldCells), 0, oldCells - 1)
      nextGrid[y][x] = grid[oldY][oldX]
    }
  }

  return nextGrid
}

function drawPixelExport(canvas, grid, cells) {
  const context = canvas.getContext("2d")
  const cellSize = canvas.width / cells

  context.imageSmoothingEnabled = false
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      if (!grid[y][x]) continue
      context.fillStyle = grid[y][x]
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
    }
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png")
  })
}

async function requestSaveFile(name) {
  if (!window.showSaveFilePicker) return null

  try {
    return await window.showSaveFilePicker({
      suggestedName: safePngName(name),
      types: [
        {
          description: "PNG image",
          accept: { "image/png": [".png"] },
        },
      ],
    })
  } catch (error) {
    if (error.name === "AbortError") return undefined
    throw error
  }
}

async function writeBlobToHandle(handle, blob) {
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function safePngName(name) {
  const baseName = name.trim().replace(/[<>:"/\\|?*]/g, "-") || "Art It!"
  return baseName.toLowerCase().endsWith(".png") ? baseName : `${baseName}.png`
}

function getCanvasPreset(id) {
  return canvasPresets.find((preset) => preset.id === id) ?? canvasPresets[1]
}

function getPixelPreset(id) {
  return pixelPresets.find((preset) => preset.id === id) ?? pixelPresets[2]
}

function folderPath(folders, currentFolder) {
  const names = []
  let folder = folders.find((item) => item.id === currentFolder)

  while (folder) {
    names.unshift(folder.name)
    folder = folders.find((item) => item.id === folder.parentId)
  }

  return names.join(" > ")
}

function getCanvasPoint(canvas, e) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: clamp(((e.clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width - 1),
    y: clamp(((e.clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height - 1),
  }
}

function getCell(point, cells) {
  return {
    x: clamp(Math.floor((point.x / pixelDisplaySize) * cells), 0, cells - 1),
    y: clamp(Math.floor((point.y / pixelDisplaySize) * cells), 0, cells - 1),
  }
}

function normalizeRect(start, end, maxWidth, maxHeight, asCells = false) {
  const x = clamp(Math.min(start.x, end.x), 0, maxWidth - 1)
  const y = clamp(Math.min(start.y, end.y), 0, maxHeight - 1)
  const right = clamp(Math.max(start.x, end.x), 0, maxWidth - 1)
  const bottom = clamp(Math.max(start.y, end.y), 0, maxHeight - 1)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(asCells ? 1 : 2, Math.round(right - x + (asCells ? 1 : 0))),
    height: Math.max(asCells ? 1 : 2, Math.round(bottom - y + (asCells ? 1 : 0))),
  }
}

function pointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  )
}

function hexToRgba(hex) {
  const value = hex.replace("#", "")
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    255,
  ]
}

function getPixel(data, width, x, y) {
  const index = (y * width + x) * 4
  return [data[index], data[index + 1], data[index + 2], data[index + 3]]
}

function setPixel(data, width, x, y, color) {
  const index = (y * width + x) * 4
  data[index] = color[0]
  data[index + 1] = color[1]
  data[index + 2] = color[2]
  data[index + 3] = color[3]
}

function colorsMatch(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

function selectionStyle(selection, artSize) {
  return {
    left: `${(selection.x / artSize.width) * 100}%`,
    top: `${(selection.y / artSize.height) * 100}%`,
    width: `${(selection.width / artSize.width) * 100}%`,
    height: `${(selection.height / artSize.height) * 100}%`,
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export default ArtIt

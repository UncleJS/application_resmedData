"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { NightBrpRow } from "@/lib/queries/brp";
import { fmtHHMMSS } from "@/lib/utils";

// ── colour tokens (match dark theme) ─────────────────────────────────────────
const C = {
  bg:        "hsl(222, 20%, 8%)",
  grid:      "hsl(222, 20%, 16%)",
  axis:      "hsl(210, 20%, 95%)",
  label:     "hsl(210, 20%, 95%)",
  flow:      "hsl(213, 90%, 55%)",
  flowFill:  "hsla(213, 90%, 55%, 0.12)",
  pressure:  "hsl(45, 90%, 55%)",
  cursor:    "hsl(210, 20%, 80%)",
} as const;

interface Props {
  /** YYYY-MM-DD sleep night date — used to call /api/brp/night/[date] */
  nightDate: string;
  /** Pixel height of the canvas (default 340) */
  height?: number;
}

/** Adaptive bucket: coarser when many points, finer when zoomed */
function calcBucket(durationMs: number, canvasWidth: number): number {
  const targetPoints = canvasWidth * 1.5;
  const raw = durationMs / targetPoints;
  if (raw <= 40)  return 40;
  if (raw <= 100) return 100;
  if (raw <= 200) return 200;
  if (raw <= 500) return 500;
  return 1000;
}

export default function NightBrpWaveformCanvas({ nightDate, height = 340 }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [data, setData]       = useState<NightBrpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // View window: absolute epoch-ms
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd,   setViewEnd]   = useState(0);
  const totalStart  = useRef(0);
  const totalEnd    = useRef(0);
  const canvasWidth = useRef(800);

  // Drag-to-pan
  const drag = useRef<{ startX: number; startViewStart: number; startViewEnd: number } | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  // ── fetch ────────────────────────────────────────────────────────────────────
  const fetchData = useCallback(
    async (start: number, end: number, width: number) => {
      setLoading(true);
      setError(null);
      const durationMs = end > start ? end - start : Number.MAX_SAFE_INTEGER;
      const bucket = calcBucket(durationMs, width);
      try {
        const res = await fetch(`/api/brp/night/${nightDate}?bucket=${bucket}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: NightBrpRow[] = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load BRP data");
      } finally {
        setLoading(false);
      }
    },
    [nightDate]
  );

  // Initial load
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 800;
    canvasWidth.current = w;
    fetchData(0, Number.MAX_SAFE_INTEGER, w);
  }, [fetchData]);

  // Set view to full extent after initial load
  useEffect(() => {
    if (data.length === 0) return;
    const first = data[0]!.epoch_ms;
    const last  = data[data.length - 1]!.epoch_ms;
    if (totalEnd.current === 0) {
      totalStart.current = first;
      totalEnd.current   = last;
      setViewStart(first);
      setViewEnd(last);
    }
  }, [data]);

  // ── draw ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0 || viewEnd === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 12, right: 60, bottom: 32, left: 52 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top  - PAD.bottom;

    const visible = data.filter((d) => d.epoch_ms >= viewStart && d.epoch_ms <= viewEnd);
    if (visible.length === 0) return;

    const tX = (ms: number) =>
      PAD.left + ((ms - viewStart) / (viewEnd - viewStart)) * plotW;

    const flows     = visible.map((d) => d.flow_l_s).filter((v) => v != null) as number[];
    const pressures = visible.map((d) => d.pressure_cmh2o).filter((v) => v != null) as number[];

    const flowMin  = Math.min(...flows);
    const flowMax  = Math.max(...flows);
    const pressMin = Math.min(...pressures);
    const pressMax = Math.max(...pressures);
    const flowRange  = flowMax  - flowMin  || 1;
    const pressRange = pressMax - pressMin || 1;

    const yFlow  = (v: number) => PAD.top + (1 - (v - flowMin)  / flowRange)  * plotH;
    const yPress = (v: number) => PAD.top + (1 - (v - pressMin) / pressRange) * plotH;

    // Clear
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth   = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD.top + (i / gridLines) * plotH;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
    }

    // X-axis ticks — absolute clock time
    ctx.fillStyle  = C.label;
    ctx.font       = "11px monospace";
    ctx.textAlign  = "center";
    const tickCount = Math.min(10, Math.floor(plotW / 70));
    for (let i = 0; i <= tickCount; i++) {
      const ms = viewStart + (i / tickCount) * (viewEnd - viewStart);
      const x  = tX(ms);
      ctx.beginPath(); ctx.strokeStyle = C.axis; ctx.lineWidth = 1;
      ctx.moveTo(x, PAD.top + plotH); ctx.lineTo(x, PAD.top + plotH + 4); ctx.stroke();
      ctx.fillText(fmtHHMMSS(ms), x, H - 6);
    }

    // Y-axis left (flow)
    ctx.textAlign = "right";
    ctx.fillStyle = C.flow;
    ctx.font      = "11px monospace";
    for (let i = 0; i <= gridLines; i++) {
      const v = flowMin + (1 - i / gridLines) * flowRange;
      const y = PAD.top + (i / gridLines) * plotH;
      ctx.fillText(v.toFixed(2), PAD.left - 4, y + 4);
    }
    ctx.save();
    ctx.translate(14, PAD.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = C.flow;
    ctx.font      = "11px sans-serif";
    ctx.fillText("Flow L/s", 0, 0);
    ctx.restore();

    // Y-axis right (pressure)
    ctx.textAlign = "left";
    ctx.fillStyle = C.pressure;
    ctx.font      = "11px monospace";
    for (let i = 0; i <= gridLines; i++) {
      const v = pressMin + (1 - i / gridLines) * pressRange;
      const y = PAD.top + (i / gridLines) * plotH;
      ctx.fillText(v.toFixed(1), PAD.left + plotW + 4, y + 4);
    }
    ctx.save();
    ctx.translate(W - 10, PAD.top + plotH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = C.pressure;
    ctx.font      = "11px sans-serif";
    ctx.fillText("cmH₂O", 0, 0);
    ctx.restore();

    // Clip to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, plotH);
    ctx.clip();

    // Flow fill
    if (flows.length > 0) {
      ctx.beginPath();
      let first = true;
      for (const d of visible) {
        if (d.flow_l_s == null) continue;
        const x = tX(d.epoch_ms);
        const y = yFlow(d.flow_l_s);
        if (first) { ctx.moveTo(x, PAD.top + plotH); ctx.lineTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      const lastVisible = visible.filter((d) => d.flow_l_s != null).slice(-1)[0];
      if (lastVisible) ctx.lineTo(tX(lastVisible.epoch_ms), PAD.top + plotH);
      ctx.closePath();
      ctx.fillStyle = C.flowFill;
      ctx.fill();
    }

    // Flow line
    if (flows.length > 0) {
      ctx.beginPath();
      let first = true;
      for (const d of visible) {
        if (d.flow_l_s == null) continue;
        const x = tX(d.epoch_ms); const y = yFlow(d.flow_l_s);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.strokeStyle = C.flow; ctx.lineWidth = 1.2; ctx.stroke();
    }

    // Pressure line
    if (pressures.length > 0) {
      ctx.beginPath();
      let first = true;
      for (const d of visible) {
        if (d.pressure_cmh2o == null) continue;
        const x = tX(d.epoch_ms); const y = yPress(d.pressure_cmh2o);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.strokeStyle = C.pressure; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Hover cursor
    if (hoverMs !== null && hoverMs >= viewStart && hoverMs <= viewEnd) {
      const x = tX(hoverMs);
      ctx.strokeStyle = C.cursor; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Border
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.strokeRect(PAD.left, PAD.top, plotW, plotH);

  }, [data, viewStart, viewEnd, hoverMs]);

  // ── wheel zoom ───────────────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas || viewEnd === 0) return;
      const rect   = canvas.getBoundingClientRect();
      const px     = (e.clientX - rect.left) / rect.width;
      const span   = viewEnd - viewStart;
      const pivot  = viewStart + px * span;
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      let ns = pivot - px       * span * factor;
      let ne = pivot + (1 - px) * span * factor;
      const minSpan = 5_000;
      ns = Math.max(totalStart.current, ns);
      ne = Math.min(totalEnd.current,   ne);
      if (ne - ns < minSpan) { ns = Math.max(totalStart.current, pivot - minSpan / 2); ne = ns + minSpan; }
      setViewStart(ns);
      setViewEnd(ne);
    },
    [viewStart, viewEnd]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── drag to pan ──────────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    drag.current = { startX: e.clientX, startViewStart: viewStart, startViewEnd: viewEnd };
  }, [viewStart, viewEnd]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect    = canvas.getBoundingClientRect();
    const PAD_LEFT  = 52;
    const PAD_RIGHT = 60;
    const plotW  = canvas.width - PAD_LEFT - PAD_RIGHT;
    const px     = Math.max(0, Math.min(plotW, e.clientX - rect.left - PAD_LEFT));
    setHoverMs(viewStart + (px / plotW) * (viewEnd - viewStart));

    if (drag.current) {
      const span  = drag.current.startViewEnd - drag.current.startViewStart;
      const dxPx  = e.clientX - drag.current.startX;
      const dxMs  = -(dxPx / plotW) * span;
      let ns = drag.current.startViewStart + dxMs;
      let ne = drag.current.startViewEnd   + dxMs;
      if (ns < totalStart.current) { ne -= (ns - totalStart.current); ns = totalStart.current; }
      if (ne > totalEnd.current)   { ns -= (ne - totalEnd.current);   ne = totalEnd.current; }
      setViewStart(Math.max(totalStart.current, ns));
      setViewEnd(Math.min(totalEnd.current, ne));
    }
  }, [viewStart, viewEnd]);

  const onMouseUp    = useCallback(() => { drag.current = null; }, []);
  const onMouseLeave = useCallback(() => { drag.current = null; setHoverMs(null); }, []);

  // ── reset zoom ───────────────────────────────────────────────────────────────
  const resetZoom = useCallback(() => {
    setViewStart(totalStart.current);
    setViewEnd(totalEnd.current);
  }, []);

  // ── canvas resize ────────────────────────────────────────────────────────────
  const [canvasW, setCanvasW] = useState(800);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]!.contentRect.width);
      if (w > 0) { setCanvasW(w); canvasWidth.current = w; }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomRatio = totalEnd.current > totalStart.current
    ? Math.round(((totalEnd.current - totalStart.current) / Math.max(1, viewEnd - viewStart)) * 10) / 10
    : 1;

  return (
    <div ref={containerRef} className="w-full select-none">
      {/* Controls bar */}
      <div className="flex items-center gap-3 mb-2 text-xs text-muted-foreground">
        <span>
          {viewEnd > 0 ? `${fmtHHMMSS(viewStart)} – ${fmtHHMMSS(viewEnd)}` : "Loading…"}
          {zoomRatio > 1.1 && <span className="ml-1 text-primary">({zoomRatio}×)</span>}
        </span>
        {hoverMs !== null && (
          <span className="font-mono">cursor: {fmtHHMMSS(hoverMs)}</span>
        )}
        <button
          onClick={resetZoom}
          className="ml-auto rounded border border-border px-2 py-0.5 hover:bg-accent transition-colors"
        >
          Reset zoom
        </button>
        <button
          onClick={() => fetchData(viewStart, viewEnd, canvasWidth.current)}
          className="rounded border border-border px-2 py-0.5 hover:bg-accent transition-colors"
        >
          Refine resolution
        </button>
      </div>

      {/* Canvas */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 rounded text-sm text-muted-foreground z-10">
            Loading waveform…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 rounded text-sm text-red-400 z-10">
            {error}
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={height}
          className="rounded cursor-crosshair"
          style={{ display: "block", width: "100%", height }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Scroll to zoom · drag to pan · &ldquo;Refine resolution&rdquo; fetches detail for current view
      </p>
    </div>
  );
}

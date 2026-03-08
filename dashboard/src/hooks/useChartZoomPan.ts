"use client";

import { useState, useRef, useCallback } from "react";

/**
 * Shared zoom-and-pan state for Recharts charts.
 *
 * Usage:
 *   const { domain, wrapperRef, wrapperProps, resetZoom, isZoomed } = useChartZoomPan(dataMin, dataMax);
 *
 * Attach `wrapperRef` AND `wrapperProps` to the div that wraps <ResponsiveContainer>.
 * Pass `domain` to the XAxis `domain` prop (type="number", scale="linear"|"time").
 *
 * Behaviour:
 *   - Scroll wheel  → zoom in/out centred on cursor position (x only)
 *   - Mouse drag    → pan left/right
 *   - Double-click  → reset to full extent
 *
 * IMPORTANT: wrapperRef is a CALLBACK REF so the native (non-passive) wheel
 * listener is attached at the exact moment the DOM node becomes available —
 * avoiding the wrapperRef.current === null race that can break useEffect(fn,[]).
 */
export function useChartZoomPan(dataMin: number, dataMax: number) {
  const [left,  setLeft]  = useState<number>(dataMin);
  const [right, setRight] = useState<number>(dataMax);

  // Always-current ref — native handlers read from here, no stale closures
  const stateRef = useRef({ left, right, dataMin, dataMax });
  stateRef.current = { left, right, dataMin, dataMax };

  // ── callback ref ─────────────────────────────────────────────────────────────
  // Called by React with the DOM node whenever it mounts/unmounts/changes.
  // Attaches a non-passive wheel listener so e.preventDefault() stops page scroll.
  //
  // IMPORTANT: Recharts ComposedChart renders an internal <rect> inside the <svg>
  // that captures mouse/wheel events for cursor/tooltip tracking. In Chromium-based
  // browsers, wheel events that target a descendant SVG element do bubble up to the
  // HTML div — but only when the SVG rect does NOT call stopPropagation. Recharts
  // does not stop propagation, so bubbling should work. However, to be safe and
  // consistent across all browsers we ALSO attach the listener directly to the
  // inner <svg> element. This guarantees the listener fires regardless of whether
  // the event hits the wrapper div or the SVG internals first.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const svgRef  = useRef<SVGSVGElement | null>(null);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = nodeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const { left: l, right: r, dataMin: dMin, dataMax: dMax } = stateRef.current;
    const span = r - l;
    if (span <= 0) return;
    // Cursor fraction along the plot area (Y-axis margins ≈ 7% left, 8% right)
    const plotLeft  = rect.left  + rect.width * 0.07;
    const plotWidth = rect.width * 0.85;
    const px    = Math.max(0, Math.min(1, (e.clientX - plotLeft) / plotWidth));
    const pivot = l + px * span;
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    let nl = pivot - px       * span * factor;
    let nr = pivot + (1 - px) * span * factor;
    const minSpan = (dMax - dMin) * 0.005; // max zoom = 0.5% of total range
    if (nl < dMin) { nr += dMin - nl; nl = dMin; }
    if (nr > dMax) { nl -= nr - dMax; nr = dMax; }
    if (nr - nl < minSpan) return;
    setLeft(Math.max(dMin, nl));
    setRight(Math.min(dMax, nr));
  }, []); // stable — reads stateRef at call time

  const wrapperRef = useCallback((node: HTMLDivElement | null) => {
    // Detach from the old nodes first
    if (nodeRef.current) {
      nodeRef.current.removeEventListener("wheel", handleWheel);
    }
    if (svgRef.current) {
      svgRef.current.removeEventListener("wheel", handleWheel);
      svgRef.current = null;
    }
    nodeRef.current = node;
    if (node) {
      // Attach to the wrapper div (catches events that bubble up from SVG)
      node.addEventListener("wheel", handleWheel, { passive: false });
      // ALSO attach directly to the inner SVG element that Recharts renders.
      // Recharts' ComposedChart puts a transparent <rect> inside the SVG that
      // receives all pointer/wheel events. By also listening on the SVG itself
      // we intercept the event before it travels to the div, ensuring
      // preventDefault() is called even if bubbling is interrupted.
      const svg = node.querySelector("svg");
      if (svg) {
        svgRef.current = svg as SVGSVGElement;
        svg.addEventListener("wheel", handleWheel, { passive: false });
      } else {
        // SVG may not be in the DOM yet (ResponsiveContainer renders async).
        // Use a MutationObserver to attach as soon as it appears.
        const observer = new MutationObserver(() => {
          const s = node.querySelector("svg");
          if (s) {
            observer.disconnect();
            svgRef.current = s as SVGSVGElement;
            s.addEventListener("wheel", handleWheel, { passive: false });
          }
        });
        observer.observe(node, { childList: true, subtree: true });
      }
    }
  }, [handleWheel]);

  // ── drag-to-pan ──────────────────────────────────────────────────────────────
  const dragRef = useRef<{
    startX: number;
    startLeft: number;
    startRight: number;
    width: number;
  } | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const { left: l, right: r } = stateRef.current;
    dragRef.current = { startX: e.clientX, startLeft: l, startRight: r, width: rect.width };
    setIsDragging(true);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { startX, startLeft, startRight, width } = dragRef.current;
    const { dataMin: dMin, dataMax: dMax } = stateRef.current;
    const span = startRight - startLeft;
    const dxPx = e.clientX - startX;
    const plotWidth = width * 0.85;
    const dxData = -(dxPx / plotWidth) * span;
    let nl = startLeft  + dxData;
    let nr = startRight + dxData;
    if (nl < dMin) { nr += dMin - nl; nl = dMin; }
    if (nr > dMax) { nl -= nr - dMax; nr = dMax; }
    setLeft(Math.max(dMin, nl));
    setRight(Math.min(dMax, nr));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // ── double-click reset ───────────────────────────────────────────────────────
  const onDoubleClick = useCallback(() => {
    const { dataMin: dMin, dataMax: dMax } = stateRef.current;
    setLeft(dMin);
    setRight(dMax);
  }, []);

  const resetZoom = useCallback(() => {
    setLeft(stateRef.current.dataMin);
    setRight(stateRef.current.dataMax);
  }, []);

  const isZoomed = left !== dataMin || right !== dataMax;
  const domain: [number, number] = [left, right];

  // wrapperProps does NOT include ref — pass wrapperRef as ref={wrapperRef} separately
  const wrapperProps = {
    onMouseDown,
    onMouseMove,
    onMouseUp:    endDrag,
    onMouseLeave: endDrag,
    onDoubleClick,
    style: { cursor: isDragging ? "grabbing" : "crosshair" } as React.CSSProperties,
  };

  return { domain, wrapperRef, wrapperProps, resetZoom, isZoomed };
}

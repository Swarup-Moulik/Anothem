import { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import { ImageUp, X, ZoomIn, ZoomOut } from "lucide-react";

/* EditablePolygon class (unchanged) */
class EditablePolygon extends fabric.Polygon {
  constructor(points, opts = {}) {
    super(points, {
      ...opts,
      hasControls: false,
      hasBorders: false,
      selectable: true,
      evented: true,
      objectCaching: false,
      perPixelTargetFind: true,
    });
    this.vertexCircles = [];
  }
  drawOutline(enable) {
    this.set({
      stroke: enable ? "#00f" : null,
      strokeWidth: enable ? 1 : 0,
    });
  }
}

/* create vertex handles — computes absolute screen positions and places center-origin circles */
function createVertexHandles(poly, canvas) {
  if (!poly.vertexCircles) poly.vertexCircles = [];

  // remove existing handles
  poly.vertexCircles.forEach((c) => {
    try { c.off && c.off(); } catch (e) { }
    try { if (canvas.contains(c)) canvas.remove(c); } catch (e) { }
  });
  poly.vertexCircles.length = 0;

  const px = poly.pathOffset?.x || 0;
  const py = poly.pathOffset?.y || 0;
  const m = poly.calcTransformMatrix();

  poly.points.forEach((p, i) => {
    const screen = fabric.util.transformPoint(new fabric.Point(p.x - px, p.y - py), m);

    const c = new fabric.Circle({
      left: screen.x,
      top: screen.y,
      radius: 5,
      fill: "#fff",
      stroke: "#00f",
      strokeWidth: 2,
      hasControls: false,
      hasBorders: false,
      originX: "center",
      originY: "center",
      selectable: false,       // set false by default; enable when editing
      evented: false,
      perPixelTargetFind: true
    });

    c._isVertex = true;
    c._parentPolygonId = poly.id;
    c.pointIndex = i;

    // hover visual (optional)
    c.on("mouseover", () => { c.radius = 7; c.setCoords(); canvas.requestRenderAll(); });
    c.on("mouseout", () => { c.radius = 5; c.setCoords(); canvas.requestRenderAll(); });

    poly.vertexCircles.push(c);
    canvas.add(c);
    try { canvas.bringToFront(c); } catch (e) { }
  });

  canvas.requestRenderAll();
}

/* enable vertex dragging — FIXED: use inverse transform mapping screen -> polygon local */
function enableVertexDragging(poly, canvas) {
  if (!poly.vertexCircles || poly.vertexCircles.length === 0) return;

  poly.vertexCircles.forEach(circle => {
    // enable the handle for interaction
    circle.set({ selectable: true, evented: true, lockMovementX: false, lockMovementY: false });

    // remove any existing handler to avoid duplicates
    try { circle.off && circle.off("moving"); } catch (e) { }

    // remove temp visuals when user grabs the handle
    circle.on("mousedown", () => {
      canvas.getObjects().slice().forEach(o => {
        if (o.id === "temp-line" || o.id === "temp-point") {
          try { canvas.remove(o); } catch (err) { }
        }
      });
    });

    // moving handler: use actual pointer coordinates from the mouse event
    circle.on("moving", (evt) => {
      const idx = circle.pointIndex;
      if (idx == null) return;

      // get accurate pointer position (screen coords)
      let pointer;
      try {
        pointer = canvas.getPointer(evt.e);
      } catch (e) {
        // fallback to circle position (should be rare)
        pointer = { x: circle.left, y: circle.top };
      }
      const screenPoint = new fabric.Point(pointer.x, pointer.y);

      // convert screen -> polygon local using inverted transform
      const m = poly.calcTransformMatrix();
      const inv = fabric.util.invertTransform(m);
      const local = fabric.util.transformPoint(screenPoint, inv);

      const ox = poly.pathOffset?.x || 0;
      const oy = poly.pathOffset?.y || 0;

      // update polygon vertex (points stored relative to pathOffset)
      poly.points[idx].x = local.x + ox;
      poly.points[idx].y = local.y + oy;

      poly.dirty = true;
      poly.setCoords();

      // update all handles
      syncVertexPositions(poly);
      canvas.requestRenderAll();

      // notify – component saves in a debounced handler
      try { canvas.fire("vertex:modified"); } catch (e) { }
    });
  });

  // cleanup when polygon removed
  try { poly.off && poly.off("removed"); } catch (e) { }
  poly.on("removed", () => {
    if (!poly.vertexCircles) return;
    poly.vertexCircles.forEach(c => { try { c.off && c.off(); if (canvas.contains(c)) canvas.remove(c); } catch (e) { } });
    poly.vertexCircles = [];
  });
}


/* update circle positions to reflect polygon's current transform */
function syncVertexPositions(poly) {
  if (!poly.vertexCircles) return;
  const px = poly.pathOffset?.x || 0;
  const py = poly.pathOffset?.y || 0;
  const m = poly.calcTransformMatrix();

  poly.vertexCircles.forEach((c, i) => {
    const p = poly.points[i];
    if (!p) return;
    const screen = fabric.util.transformPoint(new fabric.Point(p.x - px, p.y - py), m);
    c.left = screen.x;
    c.top = screen.y;
    c.setCoords();
  });
}

/* colors */
const COLORS = {
  rectangle: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.2)" },
  circle: { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.2)" },
  polygon: { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.2)" },
  point: { stroke: "transparent", fill: "#f59e0b" },
  text: { stroke: "transparent", fill: "#111827" },
  freehand: { stroke: "#3b82f6", fill: "transparent" },
};

const AnnotationCanvas = ({ image, setImage, activeTool, annotations, setAnnotations, onSelectAnnotation }) => {
  const canvasEl = useRef(null);
  const fabricRef = useRef(null);

  const isInternalUpdate = useRef(false);
  const saveAnnotationsRef = useRef(null);
  const activeToolRef = useRef(activeTool);
  const activePolygonRef = useRef(null);

  const isDragging = useRef(false);
  const lastPosX = useRef(0);
  const lastPosY = useRef(0);
  const polyPoints = useRef([]);
  const activeShape = useRef(null);

  const [dims, setDims] = useState({ width: 800, height: 600 });

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  /* init canvas */
  useEffect(() => {
    if (!canvasEl.current) return;
    if (fabricRef.current) return;

    const canvas = new fabric.Canvas(canvasEl.current, {
      selection: false, renderOnAddRemove: true,
      enableRetinaScaling: true, stopContextMenu: true,
    });
    fabricRef.current = canvas;

    canvas.on("mouse:wheel", (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.max(0.1, Math.min(zoom, 20));
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault(); opt.e.stopPropagation();
      canvas.requestRenderAll();
    });

    return () => { try { canvas.dispose(); } catch (e) { } fabricRef.current = null; };
  }, [image]);

  /* save/restore */
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    if (!isInternalUpdate.current) {
      canvas.getObjects().forEach(obj => { if (obj.id !== "backgroundImage") canvas.remove(obj); });

      annotations.forEach(a => {
        let obj;
        const style = COLORS[a.type] || COLORS.rectangle;
        const common = {
          left: a.x, top: a.y, id: a.id,
          fill: a.fill || style.fill, stroke: a.stroke || style.stroke,
          scaleX: a.scaleX, scaleY: a.scaleY, angle: a.rotation,
          selectable: false, evented: true, _customType: a.type
        };

        if (a.type === "rectangle") obj = new fabric.Rect({ ...common, width: a.width, height: a.height });
        if (a.type === "circle") obj = new fabric.Circle({ ...common, radius: a.radius });
        if (a.type === "freehand") obj = new fabric.Path(a.path, { ...common, fill: null, strokeWidth: 3 });
        if (a.type === "text") obj = new fabric.IText(a.text, { ...common, fontSize: a.fontSize, fill: COLORS.text.fill });
        if (a.type === "point") obj = new fabric.Circle({ ...common, radius: 5, _customType: "point" });

        if (a.type === "polygon") {
          const pts = a.points || [];
          if (pts.length > 0) {
            const minX = Math.min(...pts.map(p => p.x));
            const minY = Math.min(...pts.map(p => p.y));
            const rel = pts.map(p => ({ x: p.x - minX, y: p.y - minY }));
            obj = new EditablePolygon(rel, { ...common, left: minX, top: minY, strokeWidth: 0, stroke: null, objectCaching: false });
          }
        }

        if (obj) {
          canvas.add(obj);
          if (a.type === "polygon") {
            // create handles but hidden by default
            if (!obj.vertexCircles || obj.vertexCircles.length === 0) {
              createVertexHandles(obj, canvas);
              syncVertexPositions(obj);
            }
          }
        }
      });

      canvas.requestRenderAll();
    }

    isInternalUpdate.current = false;

    const saveAnnotations = () => {
      isInternalUpdate.current = true;
      const list = canvas.getObjects()
        .filter(o => o.id !== "backgroundImage" && o.id !== "temp-line" && o.id !== "temp-point" && !(o._isVertex === true) && o.id?.includes("-temp-") === false)
        .map(o => {
          const base = { id: o.id || crypto.randomUUID(), x: o.left, y: o.top, rotation: o.angle, scaleX: o.scaleX, scaleY: o.scaleY, fill: o.fill, stroke: o.stroke };
          if (o._customType === "point") return { ...base, type: "point" };
          if (o.type === "rect") return { ...base, type: "rectangle", width: o.width, height: o.height };
          if (o.type === "circle") return { ...base, type: "circle", radius: o.radius };
          if (o.type === "path") return { ...base, type: "freehand", path: o.path };
          if (o.type === "i-text") return { ...base, type: "text", text: o.text, fontSize: o.fontSize };
          if (o.type === "polygon") {
            const px = o.pathOffset?.x || 0; const py = o.pathOffset?.y || 0;
            const m = o.calcTransformMatrix();
            const absPoints = (o.points || []).map(p => {
              const screen = fabric.util.transformPoint(new fabric.Point(p.x - px, p.y - py), m);
              return { x: screen.x, y: screen.y };
            });
            return { ...base, type: "polygon", points: absPoints };
          }
          return { ...base, type: "unknown" };
        });
      setAnnotations(list);
    };

    saveAnnotationsRef.current = saveAnnotations;

    const vertexSaveDebounced = (() => { let t = null; return () => { clearTimeout(t); t = setTimeout(() => { if (saveAnnotationsRef.current) saveAnnotationsRef.current(); }, 150); }; })();
    const onVertexModified = () => vertexSaveDebounced();
    canvas.on("vertex:modified", onVertexModified);

    const updateSelection = () => { const selection = canvas.getActiveObjects(); const ids = selection.map(o => o.id); if (onSelectAnnotation) onSelectAnnotation(ids); };
    const onPathCreated = (e) => { e.path.set({ id: crypto.randomUUID(), selectable: false, stroke: COLORS.freehand.stroke }); saveAnnotations(); };

    canvas.off("object:modified", saveAnnotations);
    canvas.off("path:created", onPathCreated);
    canvas.off("selection:created", updateSelection);
    canvas.off("selection:updated", updateSelection);
    canvas.off("selection:cleared", updateSelection);

    canvas.on("object:modified", saveAnnotations);
    canvas.on("path:created", onPathCreated);
    canvas.on("selection:created", updateSelection);
    canvas.on("selection:updated", updateSelection);
    canvas.on("selection:cleared", updateSelection);

    return () => {
      canvas.off("object:modified", saveAnnotations);
      canvas.off("path:created", onPathCreated);
      canvas.off("selection:created", updateSelection);
      canvas.off("selection:updated", updateSelection);
      canvas.off("selection:cleared", updateSelection);
      canvas.off("vertex:modified", onVertexModified);
    };
  }, [annotations, setAnnotations, onSelectAnnotation]);

  /* background image loader */
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !image) return;
    const url = typeof image === "string" ? image : URL.createObjectURL(image);
    fabric.Image.fromURL(url, (img) => {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.setWidth(img.width); canvas.setHeight(img.height);
      setDims({ width: img.width, height: img.height });
      const bg = img; bg.set({ selectable: false, evented: false, id: "backgroundImage" });
      canvas.setBackgroundImage(bg, () => canvas.renderAll());
    }, { crossOrigin: "anonymous" });
  }, [image]);

  /* tool logic */
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = false; canvas.selection = false; canvas.defaultCursor = "default";
    canvas.off("mouse:dblclick");

    const isSelect = activeTool === "select";

    if (activeTool !== "polygon") {
      canvas.getObjects().forEach(o => { if (o.id === "temp-line" || o.id === "temp-point") canvas.remove(o); });
      polyPoints.current = [];
    }

    // make non-polygon shapes selectable in select mode
    canvas.getObjects().forEach(obj => {
      if (obj.id !== "backgroundImage" && !(obj.type === "polygon" || obj instanceof EditablePolygon)) {
        obj.set({ selectable: isSelect, evented: isSelect });
      }
    });

    // ensure polygon objects have handles ready (hidden unless active)
    canvas.getObjects().forEach(obj => {
      // skip background and other shapes
      if (obj.id === "backgroundImage") return;

      // general shapes: make selectable only in select mode
      if (!(obj.type === "polygon" || obj instanceof EditablePolygon)) {
        obj.set({ selectable: activeTool === "select", evented: activeTool === "select" });
        return;
      }

      // polygon-specific setup
      if (!obj.vertexCircles || obj.vertexCircles.length === 0) {
        createVertexHandles(obj, canvas);
        // do not enable handles yet — wait until polygon is activated
      } else {
        syncVertexPositions(obj);
      }

      // Make polygon itself selectable when in select tool (so user can click it to activate vertex editing)
      obj.set({ selectable: activeTool === "select", evented: activeTool === "select" });

      // Hide handles by default; they become visible when user clicks the polygon (see onDown)
      if (obj.vertexCircles) {
        obj.vertexCircles.forEach(c => c.set({ visible: false, selectable: false, evented: false }));
      }
    });



    switch (activeTool) {
      case "select": canvas.selection = true; break;
      case "pan": canvas.defaultCursor = "grab"; break;
      case "freehand": canvas.isDrawingMode = true; canvas.freeDrawingBrush.width = 3; canvas.freeDrawingBrush.color = COLORS.freehand.stroke; break;
      case "polygon": canvas.on("mouse:dblclick", finishPolygonLocal); break;
      default: canvas.defaultCursor = "crosshair"; break;
    }

    canvas.requestRenderAll();

    canvas.off("mouse:down"); canvas.off("mouse:move"); canvas.off("mouse:up");

    const onDown = (opt) => {
      const evt = opt.e; const pointer = canvas.getPointer(evt);

      if (activeTool === "pan") { isDragging.current = true; canvas.setCursor("grabbing"); lastPosX.current = evt.clientX; lastPosY.current = evt.clientY; return; }

      if (activeTool === "select") {
        // If user clicked on something
        if (opt.target) {
          // 1) Clicked a vertex handle itself
          if (opt.target._isVertex) {
            // find parent polygon by id (stored on the handle)
            const parentId = opt.target._parentPolygonId;
            const parent = canvas.getObjects().find(o => o.id === parentId);
            if (parent) {
              // mark active polygon
              activePolygonRef.current = parent;

              // Ensure handles exist and handlers are attached
              if (!parent.vertexCircles || parent.vertexCircles.length === 0) {
                createVertexHandles(parent, canvas);
                syncVertexPositions(parent);
                enableVertexDragging(parent, canvas);
              } else {
                syncVertexPositions(parent);
                enableVertexDragging(parent, canvas); // reattach handlers if needed
              }

              // Show & enable handles (and bring them to front so they receive pointer events)
              parent.vertexCircles.forEach(c => {
                c.set({ visible: true, selectable: true, evented: true });
                try { canvas.bringToFront(c); } catch (e) { /* ignore */ }
              });

              // Keep polygon above background (so handles are on top visually)
              try { canvas.bringToFront(parent); } catch (e) { /* ignore */ }

              // Do NOT clear handles — allow the handle's own mousedown/move sequence to proceed.
              // Return early so we don't run the "clear active polygon" code below.
              return;
            }
          }

          // 2) Clicked the polygon body -> activate its handles (user wants to edit vertices)
          if (opt.target.type === "polygon" || opt.target instanceof EditablePolygon) {
            // clear any previous active polygon first
            if (activePolygonRef.current && activePolygonRef.current !== opt.target) {
              const prev = activePolygonRef.current;
              if (prev.vertexCircles) {
                prev.vertexCircles.forEach(c => { try { c.off && c.off(); if (canvas.contains(c)) canvas.remove(c); } catch (e) { } });
                prev.vertexCircles = [];
              }
            }

            activePolygonRef.current = opt.target;

            if (!opt.target.vertexCircles || opt.target.vertexCircles.length === 0) {
              createVertexHandles(opt.target, canvas);
              syncVertexPositions(opt.target);
              enableVertexDragging(opt.target, canvas);
            } else {
              syncVertexPositions(opt.target);
              enableVertexDragging(opt.target, canvas);
            }

            opt.target.vertexCircles.forEach(c => {
              c.set({ visible: true, selectable: true, evented: true });
              try { canvas.bringToFront(c); } catch (e) { }
            });
            try { canvas.bringToFront(opt.target); } catch (e) { }

            // lock polygon movement while editing vertices
            opt.target.set({ selectable: false, evented: false, lockMovementX: true, lockMovementY: true });

            canvas.requestRenderAll();
            // handled the click — return so we don't clear handles
            return;
          }

          // 3) Clicked some other selectable object — fall through to "clear active polygon" logic below
        }

        // Clicked empty space or some non-polygon target: clear active polygon and its handles
        if (activePolygonRef.current) {
          const prev = activePolygonRef.current;
          if (prev.vertexCircles) {
            prev.vertexCircles.forEach(c => { try { c.off && c.off(); if (canvas.contains(c)) canvas.remove(c); } catch (e) { } });
            prev.vertexCircles = [];
          }
          activePolygonRef.current = null;
          canvas.requestRenderAll();
        }
        return;
      }

      if (activeTool === "polygon") {
        if (polyPoints.current.length > 2) {
          const start = polyPoints.current[0];
          const dist = Math.hypot(pointer.x - start.x, pointer.y - start.y);
          if (dist < 12) { finishPolygonLocal(); return; }
        }
        polyPoints.current.push({ x: pointer.x, y: pointer.y });
        const circ = new fabric.Circle({ left: pointer.x - 3, top: pointer.y - 3, radius: 3, fill: COLORS.polygon.stroke, selectable: false, evented: false, id: "temp-point" });
        canvas.add(circ);
        if (polyPoints.current.length > 1) {
          const a = polyPoints.current[polyPoints.current.length - 2];
          const b = polyPoints.current[polyPoints.current.length - 1];
          const l = new fabric.Line([a.x, a.y, b.x, b.y], { stroke: COLORS.polygon.stroke, strokeWidth: 2, selectable: false, evented: false, id: "temp-line" });
          canvas.add(l);
        }
        canvas.requestRenderAll();
        return;
      }

      if (activeTool === "text") {
        const text = new fabric.IText("Type here", { left: pointer.x, top: pointer.y, fontFamily: 'Arial', fill: COLORS.text.fill, fontSize: 20, id: crypto.randomUUID() });
        canvas.add(text); canvas.setActiveObject(text); text.enterEditing(); text.selectAll();
        if (saveAnnotationsRef.current) saveAnnotationsRef.current();
        return;
      }

      if (activeTool === "point") {
        const c = new fabric.Circle({ left: pointer.x - 5, top: pointer.y - 5, radius: 5, fill: COLORS.point.fill, id: crypto.randomUUID(), _customType: 'point' });
        canvas.add(c); if (saveAnnotationsRef.current) saveAnnotationsRef.current(); return;
      }

      if (activeTool === "rectangle" || activeTool === "circle") {
        if (opt.target) return;
        isDragging.current = true; activeShape.current = null; const id = crypto.randomUUID();
        if (activeTool === "rectangle") {
          activeShape.current = new fabric.Rect({ left: pointer.x, top: pointer.y, width: 0, height: 0, fill: COLORS.rectangle.fill, stroke: COLORS.rectangle.stroke, strokeWidth: 2, id, selectable: false });
        } else {
          activeShape.current = new fabric.Circle({ left: pointer.x, top: pointer.y, radius: 0, fill: COLORS.circle.fill, stroke: COLORS.circle.stroke, strokeWidth: 2, id, selectable: false });
        }
        canvas.add(activeShape.current);
      }
    };

    const onMove = (opt) => {
      const evt = opt.e; const pointer = canvas.getPointer(evt);
      if (activeTool === "pan" && isDragging.current) {
        const vpt = canvas.viewportTransform; vpt[4] += evt.clientX - lastPosX.current; vpt[5] += evt.clientY - lastPosY.current;
        canvas.requestRenderAll(); lastPosX.current = evt.clientX; lastPosY.current = evt.clientY; return;
      }
      if (isDragging.current && activeShape.current) {
        const shape = activeShape.current; const startX = shape.left, startY = shape.top;
        if (activeTool === "rectangle") shape.set({ width: Math.abs(pointer.x - startX), height: Math.abs(pointer.y - startY) });
        else if (activeTool === "circle") shape.set({ radius: Math.hypot(pointer.x - startX, pointer.y - startY) });
        canvas.requestRenderAll();
      }
    };

    const onUp = () => {
      if (activeTool === "pan") { canvas.setCursor("grab"); isDragging.current = false; return; }
      if (isDragging.current && activeShape.current) {
        activeShape.current.setCoords(); if (saveAnnotationsRef.current) saveAnnotationsRef.current();
      }
      isDragging.current = false; activeShape.current = null;
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);

    const onKeyDown = (e) => {
      if (e.key === "Delete" || e.key === "Del") {
        const poly = activePolygonRef.current;
        if (poly && canvas) {
          if (poly.vertexCircles) {
            poly.vertexCircles.forEach(c => { try { c.off && c.off(); if (canvas.contains(c)) canvas.remove(c); } catch (err) { } });
            poly.vertexCircles = [];
          }
          try { canvas.remove(poly); } catch (err) { }
          activePolygonRef.current = null;
          if (saveAnnotationsRef.current) saveAnnotationsRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => { canvas.off("mouse:down", onDown); canvas.off("mouse:move", onMove); canvas.off("mouse:up", onUp); canvas.off("mouse:dblclick", finishPolygonLocal); window.removeEventListener("keydown", onKeyDown); };
  }, [activeTool]);

  function finishPolygonLocal() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (polyPoints.current.length < 3) return;

    // compute min origin then create polygon with relative points
    const pts = polyPoints.current.slice();
    const minX = Math.min(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const rel = pts.map(p => ({ x: p.x - minX, y: p.y - minY }));

    const poly = new EditablePolygon(rel, {
      left: minX, top: minY, fill: COLORS.polygon.fill,
      stroke: null, strokeWidth: 0, id: crypto.randomUUID(), objectCaching: false, selectable: true, evented: true
    });

    canvas.add(poly);

    // remove temp visuals
    canvas.getObjects().slice().forEach(o => { if (o.id === "temp-line" || o.id === "temp-point") canvas.remove(o); });

    polyPoints.current = [];

    activePolygonRef.current = poly;
    createVertexHandles(poly, canvas);
    enableVertexDragging(poly, canvas);
    syncVertexPositions(poly);
    poly.vertexCircles.forEach(c => {
      c.set({ visible: true, selectable: true, evented: true });
      canvas.bringToFront(c);
    });
    canvas.bringToFront(poly);
    // lock polygon itself
    poly.set({ selectable: false, lockMovementX: true, lockMovementY: true });

    if (saveAnnotationsRef.current) saveAnnotationsRef.current();
  }

  /* wrapper local makeEditable — used after restore and on activation */
  function makePolygonEditableLocal(poly) {
    const canvas = fabricRef.current;
    if (!canvas || !poly) return;
    try { poly.off && poly.off("moving"); poly.off && poly.off("scaling"); poly.off && poly.off("rotating"); } catch (e) { }

    poly.hasBorders = false; poly.hasControls = false; poly.drawOutline(false);

    if (!poly.vertexCircles || poly.vertexCircles.length === 0) {
      createVertexHandles(poly, canvas);
      enableVertexDragging(poly, canvas);
    } else {
      syncVertexPositions(poly);
    }

    const isActive = activePolygonRef.current && activePolygonRef.current.id === poly.id;
    poly.vertexCircles.forEach(c => c.set({ visible: isActive, selectable: isActive }));

    if (isActive) poly.set({ selectable: false, lockMovementX: true, lockMovementY: true });
    else poly.set({ selectable: true, lockMovementX: false, lockMovementY: false });

    canvas.requestRenderAll();
  }

  const manualZoom = (factor) => {
    const canvas = fabricRef.current; if (!canvas) return;
    let zoom = canvas.getZoom(); zoom *= factor; zoom = Math.max(0.1, Math.min(zoom, 20));
    const center = canvas.getCenter(); canvas.zoomToPoint({ x: center.left, y: center.top }, zoom);
  };

  return (
    <div className="grow bg-white border rounded-lg p-4 overflow-auto relative h-screen">
      <div className="flex justify-center items-center bg-gray-100 h-full rounded-lg overflow-hidden relative">
        {image ? (
          <>
            <div className="relative border shadow bg-white" style={{ width: dims.width, height: dims.height }}>
              <canvas ref={canvasEl} />
            </div>

            <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
              <button onClick={() => { if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null; } setImage(null); setAnnotations([]); if (onSelectAnnotation) onSelectAnnotation([]); }} className="bg-white p-2 rounded-full shadow text-red-500 hover:bg-red-50" title="Close Image"><X size={20} /></button>

              <div className="bg-white rounded-lg shadow flex flex-col mt-2">
                <button onClick={() => manualZoom(1.1)} className="p-2 hover:bg-gray-50 border-b" title="Zoom In"><ZoomIn size={20} /></button>
                <button onClick={() => manualZoom(0.9)} className="p-2 hover:bg-gray-50" title="Zoom Out"><ZoomOut size={20} /></button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center max-h-full">
            <ImageUp size={48} className="mx-auto text-gray-400" />
            <p className="text-gray-500 mt-4">Upload an image to start</p>
            <input type="file" id="img" className="hidden" onChange={(e) => setImage(e.target.files[0])} />
            <label htmlFor="img" className="mt-4 inline-block bg-blue-600 text-white px-4 py-2 rounded cursor-pointer">Choose Image</label>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationCanvas;

// AnnotationCanvas.jsx
import { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import { ImageUp, X, ZoomIn, ZoomOut } from "lucide-react";

/**
 * VGG VIA style polygon editor:
 * - Polygons are not selectable (no bbox / controls)
 * - Only vertices are shown and draggable
 * - Add vertex by click, finish by double-click near first point
 * - Delete active polygon with Delete key
 *
 * This file is self-contained and designed to plug into your existing Home component.
 */

/* -------------------- EditablePolygon class -------------------- */
class EditablePolygon extends fabric.Polygon {
  constructor(points, opts = {}) {
    // Fabric expects point objects like { x, y }
    super(points, {
      ...opts,
      // disable Fabric controls & bounding box
      hasControls: false,
      hasBorders: false,
      selectable: false,
      evented: true, // still receive pointer events
      objectCaching: false,
      perPixelTargetFind: true,
    });
    // container for vertex circles
    this.vertexCircles = [];
  }

  drawOutline(enable) {
    this.set({
      stroke: enable ? "#00f" : null,
      strokeWidth: enable ? 1 : 0,
    });
  }
}

/* -------------------- Helpers (top-level, no React refs) -------------------- */

/**
 * Create vertex handles for polygon.
 * Handles are non-selectable by default and flagged with _isVertex.
 */
function createVertexHandles(poly, canvas) {
  if (!poly) return;
  if (!poly.vertexCircles) poly.vertexCircles = [];

  // remove existing handles cleanly
  poly.vertexCircles.forEach((c) => {
    try {
      c.off && c.off();
    } catch (e) {}
    try {
      if (canvas.contains(c)) canvas.remove(c);
    } catch (e) {}
  });
  poly.vertexCircles.length = 0;

  const px = poly.pathOffset?.x || 0;
  const py = poly.pathOffset?.y || 0;
  const m = poly.calcTransformMatrix();

  // create new handles
  poly.points.forEach((p, i) => {
    const screen = fabric.util.transformPoint(
      new fabric.Point(p.x - px, p.y - py),
      m
    );

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
      selectable: false, // default non-selectable; toggled by editor
      hoverCursor: "pointer",
      perPixelTargetFind: true,
      evented: true,
    });

    c._isVertex = true;
    c._parentPolygonId = poly.id;
    c.pointIndex = i;

    // hover highlight (temporary visual)
    c.on("mouseover", () => {
      try {
        c.radius = 7;
        c.setCoords();
        canvas.requestRenderAll();
      } catch (e) {}
    });
    c.on("mouseout", () => {
      try {
        c.radius = 5;
        c.setCoords();
        canvas.requestRenderAll();
      } catch (e) {}
    });

    poly.vertexCircles.push(c);
    canvas.add(c);
    // keep handles on top
    try {
      canvas.bringToFront(c);
    } catch (e) {}
  });

  canvas.requestRenderAll();
}

/**
 * Enable dragging of vertex handles. Fires canvas event 'vertex:modified' on change.
 */
function enableVertexDragging(poly, canvas) {
  if (!poly || !poly.vertexCircles) return;

  poly.vertexCircles.forEach((circle) => {
    try {
      circle.off && circle.off("moving");
    } catch (e) {}

    circle.on("moving", () => {
      const idx = circle.pointIndex;
      if (idx == null) return;

      // get canvas coordinates of circle and convert to polygon local coords
      const local = poly.toLocalPoint(new fabric.Point(circle.left, circle.top));
      const ox = poly.pathOffset?.x || 0;
      const oy = poly.pathOffset?.y || 0;

      // update polygon points (Fabric polygon stores coords relative to pathOffset)
      poly.points[idx].x = local.x + ox;
      poly.points[idx].y = local.y + oy;

      poly.dirty = true;
      poly.setCoords();

      // update other handles positions
      syncVertexPositions(poly);

      // redraw
      canvas.requestRenderAll();

      // notify component to save (debounced on component side)
      try {
        canvas.fire("vertex:modified");
      } catch (e) {}
    });
  });

  // cleanup when polygon removed
  try {
    poly.off && poly.off("removed");
  } catch (e) {}
  poly.on("removed", () => {
    if (!poly.vertexCircles) return;
    poly.vertexCircles.forEach((c) => {
      try {
        c.off && c.off();
        if (canvas.contains(c)) canvas.remove(c);
      } catch (e) {}
    });
    poly.vertexCircles = [];
  });
}

/**
 * Reposition vertex handles according to polygon current transform.
 */
function syncVertexPositions(poly) {
  if (!poly || !poly.vertexCircles) return;
  const px = poly.pathOffset?.x || 0;
  const py = poly.pathOffset?.y || 0;
  const m = poly.calcTransformMatrix();

  poly.vertexCircles.forEach((c, i) => {
    const p = poly.points[i];
    if (!p) return;
    const screen = fabric.util.transformPoint(
      new fabric.Point(p.x - px, p.y - py),
      m
    );
    c.left = screen.x;
    c.top = screen.y;
    c.setCoords();
  });
}

/* -------------------- COLORS -------------------- */
const COLORS = {
  rectangle: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.2)" },
  circle: { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.2)" },
  polygon: { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.2)" },
  point: { stroke: "transparent", fill: "#f59e0b" },
  text: { stroke: "transparent", fill: "#111827" },
  freehand: { stroke: "#3b82f6", fill: "transparent" },
};

/* -------------------- COMPONENT -------------------- */
const AnnotationCanvas = ({
  image,
  setImage,
  activeTool,
  annotations,
  setAnnotations,
  onSelectAnnotation,
}) => {
  const canvasEl = useRef(null);
  const fabricRef = useRef(null);

  // refs
  const isInternalUpdate = useRef(false);
  const saveAnnotationsRef = useRef(null);
  const activeToolRef = useRef(activeTool);
  const activePolygonRef = useRef(null); // polygon that is currently active (for delete/edit)

  // drawing state
  const isDragging = useRef(false);
  const lastPosX = useRef(0);
  const lastPosY = useRef(0);
  const polyPoints = useRef([]); // temporary points when drawing polygon
  const activeShape = useRef(null);

  const [dims, setDims] = useState({ width: 800, height: 600 });

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  /* -------------------- Initialize fabric canvas -------------------- */
  useEffect(() => {
    if (!canvasEl.current) return;
    if (fabricRef.current) return;

    const canvas = new fabric.Canvas(canvasEl.current, {
      selection: false,
      renderOnAddRemove: true,
      enableRetinaScaling: true,
      stopContextMenu: true,
    });
    fabricRef.current = canvas;

    // wheel zoom
    canvas.on("mouse:wheel", (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 20) zoom = 20;
      if (zoom < 0.1) zoom = 0.1;
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
      canvas.requestRenderAll();
    });

    return () => {
      try {
        canvas.dispose();
      } catch (e) {}
      fabricRef.current = null;
    };
  }, [image]);

  /* -------------------- Save/Restore annotations -------------------- */
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // wipe existing (except backgroundImage)
    if (!isInternalUpdate.current) {
      canvas.getObjects().forEach((o) => {
        if (o.id !== "backgroundImage") canvas.remove(o);
      });

      // restore annotations
      annotations.forEach((a) => {
        let obj;
        const style = COLORS[a.type] || COLORS.rectangle;
        const common = {
          left: a.x,
          top: a.y,
          id: a.id,
          fill: a.fill || style.fill,
          stroke: a.stroke || style.stroke,
          scaleX: a.scaleX,
          scaleY: a.scaleY,
          angle: a.rotation,
          selectable: false,
          evented: true,
          _customType: a.type,
        };

        if (a.type === "rectangle")
          obj = new fabric.Rect({ ...common, width: a.width, height: a.height });
        if (a.type === "circle") obj = new fabric.Circle({ ...common, radius: a.radius });
        if (a.type === "polygon") {
          obj = new EditablePolygon(a.points.map((p) => ({ x: p.x, y: p.y })), {
            ...common,
            strokeWidth: 0,
            stroke: null,
            objectCaching: false,
          });
        }
        if (a.type === "freehand") obj = new fabric.Path(a.path, { ...common, fill: null, strokeWidth: 3 });
        if (a.type === "text") obj = new fabric.IText(a.text, { ...common, fontSize: a.fontSize, fill: COLORS.text.fill });

        if (a.type === "point") obj = new fabric.Circle({ ...common, radius: 5, _customType: "point" });

        if (obj) {
          canvas.add(obj);
          if (a.type === "polygon") {
            makePolygonEditable(obj); // create handles (hidden if not active)
          }
        }
      });

      canvas.requestRenderAll();
    }

    isInternalUpdate.current = false;

    // save function used by component
    const saveAnnotations = () => {
      isInternalUpdate.current = true;
      const list = canvas
        .getObjects()
        .filter(
          (o) =>
            o.id !== "backgroundImage" &&
            o.id !== "temp-line" &&
            o.id !== "temp-point" &&
            !(o._isVertex === true) &&
            o.id?.includes("-temp-") === false
        )
        .map((o) => {
          const base = {
            id: o.id || crypto.randomUUID(),
            x: o.left,
            y: o.top,
            rotation: o.angle,
            scaleX: o.scaleX,
            scaleY: o.scaleY,
            fill: o.fill,
            stroke: o.stroke,
          };

          if (o._customType === "point") return { ...base, type: "point" };
          if (o.type === "rect") return { ...base, type: "rectangle", width: o.width, height: o.height };
          if (o.type === "circle") return { ...base, type: "circle", radius: o.radius };
          if (o.type === "polygon") return { ...base, type: "polygon", points: o.points.map((p) => ({ x: p.x, y: p.y })) };
          if (o.type === "path") return { ...base, type: "freehand", path: o.path };
          if (o.type === "i-text") return { ...base, type: "text", text: o.text, fontSize: o.fontSize };

          return { ...base, type: "unknown" };
        });

      setAnnotations(list);
    };

    saveAnnotationsRef.current = saveAnnotations;

    // debounced save for vertex modifications
    const vertexSaveDebounced = (() => {
      let t = null;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => {
          if (saveAnnotationsRef.current) saveAnnotationsRef.current();
        }, 150);
      };
    })();

    const onVertexModified = () => vertexSaveDebounced();
    canvas.on("vertex:modified", onVertexModified);

    // selection update (keeps behavior for other tools)
    const updateSelection = () => {
      const selection = canvas.getActiveObjects();
      const ids = selection.map((o) => o.id);
      if (onSelectAnnotation) onSelectAnnotation(ids);
    };

    // path created (freehand)
    const onPathCreated = (e) => {
      e.path.set({ id: crypto.randomUUID(), selectable: false, stroke: COLORS.freehand.stroke });
      saveAnnotations();
    };

    // bind
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

  /* -------------------- Background image loader -------------------- */
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !image) return;

    const url = typeof image === "string" ? image : URL.createObjectURL(image);

    fabric.Image.fromURL(
      url,
      (img) => {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.setWidth(img.width);
        canvas.setHeight(img.height);
        setDims({ width: img.width, height: img.height });

        const bg = img;
        bg.set({ selectable: false, evented: false, id: "backgroundImage" });
        canvas.setBackgroundImage(bg, () => canvas.renderAll());
      },
      { crossOrigin: "anonymous" }
    );
  }, [image]);

  /* -------------------- Polygon editor behavior (tool logic) -------------------- */
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // reset drawing mode & cursor defaults
    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.defaultCursor = "default";
    canvas.off("mouse:dblclick");

    const isSelect = activeTool === "select";

    // Clear any in-progress polygon temps when switching out of polygon tool
    if (activeTool !== "polygon") {
      canvas.getObjects().forEach((o) => {
        if (o.id === "temp-line" || o.id === "temp-point") canvas.remove(o);
      });
      polyPoints.current = [];
    }

    // Basic selectability for non-polygons (we'll handle polygons separately)
    canvas.getObjects().forEach((obj) => {
      if (obj.id !== "backgroundImage") {
        obj.set({ selectable: isSelect, evented: isSelect });
      }
    });

    // Polygons: ensure they have handles but keep handles hidden unless active polygon
    canvas.getObjects().forEach((obj) => {
      if (obj.type === "polygon" || obj instanceof EditablePolygon) {
        // ensure EditablePolygon behavior
        makePolygonEditable(obj);

        // handles visible only for the active polygon
        const isActive = activePolygonRef.current && activePolygonRef.current.id === obj.id;
        if (obj.vertexCircles) {
          obj.vertexCircles.forEach((c) => c.set({ visible: isActive, selectable: isActive }));
        }
      }
    });

    // Tool-specific bindings
    switch (activeTool) {
      case "select":
        canvas.selection = true;
        break;
      case "pan":
        canvas.defaultCursor = "grab";
        break;
      case "freehand":
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.width = 3;
        canvas.freeDrawingBrush.color = COLORS.freehand.stroke;
        break;
      case "polygon":
        canvas.on("mouse:dblclick", finishPolygon);
        break;
      default:
        canvas.defaultCursor = "crosshair";
        break;
    }

    canvas.requestRenderAll();

    // Mouse handlers (we manage them per tool)
    canvas.off("mouse:down");
    canvas.off("mouse:move");
    canvas.off("mouse:up");

    const onDown = (opt) => {
      const evt = opt.e;
      const pointer = canvas.getPointer(evt);

      // PAN
      if (activeTool === "pan") {
        isDragging.current = true;
        canvas.setCursor("grabbing");
        lastPosX.current = evt.clientX;
        lastPosY.current = evt.clientY;
        return;
      }

      // SELECT (click on polygon fill to make active)
      if (activeTool === "select") {
        // if clicked on a polygon area (object evented), set it active
        if (opt.target && (opt.target.type === "polygon" || opt.target instanceof EditablePolygon)) {
          // clear previous active polygon handles
          if (activePolygonRef.current && activePolygonRef.current !== opt.target) {
            const prev = activePolygonRef.current;
            if (prev.vertexCircles) {
              prev.vertexCircles.forEach((c) => {
                try {
                  c.set({ visible: false, selectable: false });
                  c.off && c.off();
                  if (canvas.contains(c)) canvas.remove(c);
                } catch (e) {}
              });
              prev.vertexCircles = [];
            }
          }

          activePolygonRef.current = opt.target;
          // create and show handles for this polygon
          makePolygonEditable(opt.target);
          if (opt.target.vertexCircles) {
            opt.target.vertexCircles.forEach((c) => c.set({ visible: true, selectable: true }));
          }
          canvas.requestRenderAll();
          return;
        } else {
          // clicked outside polygons -> clear active polygon
          if (activePolygonRef.current) {
            const prev = activePolygonRef.current;
            if (prev.vertexCircles) {
              prev.vertexCircles.forEach((c) => {
                try {
                  c.set({ visible: false, selectable: false });
                  c.off && c.off();
                  if (canvas.contains(c)) canvas.remove(c);
                } catch (e) {}
              });
              prev.vertexCircles = [];
            }
            activePolygonRef.current = null;
            canvas.requestRenderAll();
          }
        }
        return;
      }

      // POLYGON DRAWING
      if (activeTool === "polygon") {
        // if we have >2 points and near the start, finish polygon
        if (polyPoints.current.length > 2) {
          const startPoint = polyPoints.current[0];
          const dist = Math.hypot(pointer.x - startPoint.x, pointer.y - startPoint.y);
          if (dist < 12) {
            finishPolygon();
            return;
          }
        }
        // add temp point and temp line for visual feedback
        polyPoints.current.push({ x: pointer.x, y: pointer.y });
        const circ = new fabric.Circle({
          left: pointer.x - 3,
          top: pointer.y - 3,
          radius: 3,
          fill: COLORS.polygon.stroke,
          selectable: false,
          evented: false,
          id: "temp-point",
        });
        canvas.add(circ);
        if (polyPoints.current.length > 1) {
          const a = polyPoints.current[polyPoints.current.length - 2];
          const b = polyPoints.current[polyPoints.current.length - 1];
          const l = new fabric.Line([a.x, a.y, b.x, b.y], {
            stroke: COLORS.polygon.stroke,
            strokeWidth: 2,
            selectable: false,
            evented: false,
            id: "temp-line",
          });
          canvas.add(l);
        }
        canvas.requestRenderAll();
        return;
      }

      // TEXT
      if (activeTool === "text") {
        const text = new fabric.IText("Type here", {
          left: pointer.x,
          top: pointer.y,
          fontFamily: "Arial",
          fill: COLORS.text.fill,
          fontSize: 20,
          id: crypto.randomUUID(),
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        if (saveAnnotationsRef.current) saveAnnotationsRef.current();
        return;
      }

      // POINT
      if (activeTool === "point") {
        const circle = new fabric.Circle({
          left: pointer.x - 5,
          top: pointer.y - 5,
          radius: 5,
          fill: COLORS.point.fill,
          id: crypto.randomUUID(),
          _customType: "point",
        });
        canvas.add(circle);
        if (saveAnnotationsRef.current) saveAnnotationsRef.current();
        return;
      }

      // SHAPES
      if (activeTool === "rectangle" || activeTool === "circle") {
        if (opt.target) return;
        isDragging.current = true;
        activeShape.current = null;
        const id = crypto.randomUUID();
        if (activeTool === "rectangle") {
          activeShape.current = new fabric.Rect({
            left: pointer.x,
            top: pointer.y,
            width: 0,
            height: 0,
            fill: COLORS.rectangle.fill,
            stroke: COLORS.rectangle.stroke,
            strokeWidth: 2,
            id,
            selectable: false,
          });
        } else {
          activeShape.current = new fabric.Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 0,
            fill: COLORS.circle.fill,
            stroke: COLORS.circle.stroke,
            strokeWidth: 2,
            id,
            selectable: false,
          });
        }
        canvas.add(activeShape.current);
      }
    };

    const onMove = (opt) => {
      const evt = opt.e;
      const pointer = canvas.getPointer(evt);

      if (activeTool === "pan" && isDragging.current) {
        const vpt = canvas.viewportTransform;
        vpt[4] += evt.clientX - lastPosX.current;
        vpt[5] += evt.clientY - lastPosY.current;
        canvas.requestRenderAll();
        lastPosX.current = evt.clientX;
        lastPosY.current = evt.clientY;
        return;
      }

      if (isDragging.current && activeShape.current) {
        const shape = activeShape.current;
        const startX = shape.left;
        const startY = shape.top;
        if (activeTool === "rectangle") {
          shape.set({
            width: Math.abs(pointer.x - startX),
            height: Math.abs(pointer.y - startY),
          });
        } else if (activeTool === "circle") {
          shape.set({ radius: Math.hypot(pointer.x - startX, pointer.y - startY) });
        }
        canvas.requestRenderAll();
      }
    };

    const onUp = () => {
      if (activeTool === "pan") {
        canvas.setCursor("grab");
        isDragging.current = false;
        return;
      }

      if (isDragging.current && activeShape.current) {
        activeShape.current.setCoords();
        if (saveAnnotationsRef.current) saveAnnotationsRef.current();
      }

      isDragging.current = false;
      activeShape.current = null;
    };

    canvas.on("mouse:down", onDown);
    canvas.on("mouse:move", onMove);
    canvas.on("mouse:up", onUp);

    // Keyboard: Delete key to remove active polygon
    const onKeyDown = (e) => {
      if (e.key === "Delete" || e.key === "Del") {
        const canvas = fabricRef.current;
        const poly = activePolygonRef.current;
        if (canvas && poly) {
          // remove vertex handles
          if (poly.vertexCircles) {
            poly.vertexCircles.forEach((c) => {
              try {
                c.off && c.off();
                if (canvas.contains(c)) canvas.remove(c);
              } catch (err) {}
            });
            poly.vertexCircles = [];
          }
          // remove polygon itself
          try {
            canvas.remove(poly);
          } catch (err) {}
          activePolygonRef.current = null;
          if (saveAnnotationsRef.current) saveAnnotationsRef.current();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    // cleanup on effect end
    return () => {
      canvas.off("mouse:down", onDown);
      canvas.off("mouse:move", onMove);
      canvas.off("mouse:up", onUp);
      canvas.off("mouse:dblclick", finishPolygon);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTool]);

  /* -------------------- finishPolygon -------------------- */
  function finishPolygon() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (polyPoints.current.length < 3) return;

    const poly = new EditablePolygon(polyPoints.current.map((p) => ({ x: p.x, y: p.y })), {
      fill: COLORS.polygon.fill,
      stroke: null,
      strokeWidth: 0,
      id: crypto.randomUUID(),
      objectCaching: false,
      selectable: false,
      evented: true,
    });

    canvas.add(poly);

    // clear temporary visuals
    canvas.getObjects().forEach((obj) => {
      if (obj.id === "temp-line" || obj.id === "temp-point") canvas.remove(obj);
    });

    polyPoints.current = [];

    // set as active polygon (show handles & enable dragging)
    activePolygonRef.current = poly;
    makePolygonEditable(poly);
    if (poly.vertexCircles) poly.vertexCircles.forEach((c) => c.set({ visible: true, selectable: true }));
    enableVertexDragging(poly, canvas);

    // small save
    if (saveAnnotationsRef.current) saveAnnotationsRef.current();
  }

  /* -------------------- makePolygonEditable (component local wrapper) -------------------- */
  function makePolygonEditable(poly) {
    const canvas = fabricRef.current;
    if (!canvas || !poly) return;

    // remove existing per-polygon listeners to avoid duplicates
    try {
      poly.off && poly.off("moving");
      poly.off && poly.off("scaling");
      poly.off && poly.off("rotating");
    } catch (e) {}

    poly.hasBorders = false;
    poly.hasControls = false;
    poly.drawOutline(false);

    // create handles only if not already created
    if (!poly.vertexCircles || poly.vertexCircles.length === 0) {
      createVertexHandles(poly, canvas);
      enableVertexDragging(poly, canvas);
    } else {
      // ensure positions are in sync
      syncVertexPositions(poly);
    }

    // show/hide handles according to whether this polygon is active
    const isActive = activePolygonRef.current && activePolygonRef.current.id === poly.id;
    poly.vertexCircles.forEach((c) => c.set({ visible: isActive, selectable: isActive }));

    // ensure polygon not selectable
    poly.set({ selectable: false, evented: true });

    canvas.requestRenderAll();
  }

  /* -------------------- manualZoom -------------------- */
  const manualZoom = (factor) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let zoom = canvas.getZoom();
    zoom *= factor;
    if (zoom > 20) zoom = 20;
    if (zoom < 0.1) zoom = 0.1;
    const center = canvas.getCenter();
    canvas.zoomToPoint({ x: center.left, y: center.top }, zoom);
  };

  /* -------------------- Render -------------------- */
  return (
    <div className="grow bg-white border rounded-lg p-4 overflow-auto relative h-screen">
      <div className="flex justify-center items-center bg-gray-100 h-full rounded-lg overflow-hidden relative">
        {image ? (
          <>
            <div className="relative border shadow bg-white" style={{ width: dims.width, height: dims.height }}>
              <canvas ref={canvasEl} />
            </div>

            <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
              <button
                onClick={() => {
                  if (fabricRef.current) {
                    fabricRef.current.dispose();
                    fabricRef.current = null;
                  }
                  setImage(null);
                  setAnnotations([]);
                  if (onSelectAnnotation) onSelectAnnotation([]);
                }}
                className="bg-white p-2 rounded-full shadow text-red-500 hover:bg-red-50"
                title="Close Image"
              >
                <X size={20} />
              </button>

              <div className="bg-white rounded-lg shadow flex flex-col mt-2">
                <button onClick={() => manualZoom(1.1)} className="p-2 hover:bg-gray-50 border-b" title="Zoom In">
                  <ZoomIn size={20} />
                </button>
                <button onClick={() => manualZoom(0.9)} className="p-2 hover:bg-gray-50" title="Zoom Out">
                  <ZoomOut size={20} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center max-h-full">
            <ImageUp size={48} className="mx-auto text-gray-400" />
            <p className="text-gray-500 mt-4">Upload an image to start</p>
            <input type="file" id="img" className="hidden" onChange={(e) => setImage(e.target.files[0])} />
            <label htmlFor="img" className="mt-4 inline-block bg-blue-600 text-white px-4 py-2 rounded cursor-pointer">
              Choose Image
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationCanvas;

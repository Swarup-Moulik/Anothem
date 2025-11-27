import { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import { ImageUp, X, ZoomIn, ZoomOut } from "lucide-react";

// --- COLOR CONFIGURATION ---
const COLORS = {
  rectangle: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.2)' },
  circle:    { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.2)' },
  polygon:   { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.2)' },
  point:     { stroke: 'transparent', fill: '#f59e0b' },
  text:      { stroke: 'transparent', fill: '#111827' },
  freehand:  { stroke: '#3b82f6', fill: 'transparent' },
};

const AnnotationCanvas = ({
  image,
  setImage,
  activeTool,
  annotations,
  setAnnotations,
  onSelectAnnotation
}) => {
  const canvasEl = useRef(null);
  const fabricRef = useRef(null);
  
  // --- STATE & REFS ---
  const isInternalUpdate = useRef(false);
  const saveAnnotationsRef = useRef(null);
  const activeToolRef = useRef(activeTool);

  const isDragging = useRef(false);
  const lastPosX = useRef(0);
  const lastPosY = useRef(0);
  const polyPoints = useRef([]); 
  const activeShape = useRef(null);

  const [dims, setDims] = useState({ width: 800, height: 600 });

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  // 1. INITIALIZE FABRIC
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
      if (fabricRef.current) fabricRef.current.dispose();
      fabricRef.current = null;
    };
  }, [image]);

  // 2. DATA SYNC & RESTORE
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    if (!isInternalUpdate.current) {
        // Wipe Canvas (Keep Background)
        canvas.getObjects().forEach((obj) => {
            if (obj.id !== "backgroundImage") {
                canvas.remove(obj);
            }
        });

        // Restore Objects
        annotations.forEach(a => {
            let obj;
            const typeStyle = COLORS[a.type] || COLORS.rectangle;
            
            const common = { 
                left: a.x, top: a.y, id: a.id, 
                fill: a.fill || typeStyle.fill, 
                stroke: a.stroke || typeStyle.stroke, 
                scaleX: a.scaleX, scaleY: a.scaleY,
                angle: a.rotation,
                selectable: activeToolRef.current === 'select',
                evented: activeToolRef.current === 'select',
                // IMPORTANT: Re-attach custom type tag on restore
                _customType: a.type 
            };
            
            if (a.type === "rectangle") obj = new fabric.Rect({ ...common, width: a.width, height: a.height });
            if (a.type === "circle") obj = new fabric.Circle({ ...common, radius: a.radius });
            if (a.type === "polygon") obj = new fabric.Polygon(a.points.map(p => ({x: p.x, y: p.y})), { ...common, strokeWidth: 2 });
            if (a.type === "freehand") obj = new fabric.Path(a.path, { ...common, fill: null, strokeWidth: 3 });
            if (a.type === "text") obj = new fabric.IText(a.text, { ...common, fontSize: a.fontSize, fill: COLORS.text.fill });
            
            // Restore Point
            if (a.type === "point") {
                 obj = new fabric.Circle({ ...common, radius: 5 });
            }

            if(obj) canvas.add(obj);
        });
        
        canvas.requestRenderAll();
    }

    isInternalUpdate.current = false;

    // --- SAVE FUNCTION ---
    const saveAnnotations = () => {
        isInternalUpdate.current = true;
        
        const list = canvas.getObjects()
          .filter((o) => o.id !== "backgroundImage" && o.id !== "temp-line" && o.id !== "temp-point" && o.id?.includes("-temp-") === false)
          .map((o) => {
            const base = {
              id: o.id || crypto.randomUUID(),
              x: o.left, y: o.top,
              rotation: o.angle,
              scaleX: o.scaleX, scaleY: o.scaleY,
              fill: o.fill, stroke: o.stroke
            };
            
            // Check for custom type tag first (for Points)
            if (o._customType === "point") return { ...base, type: "point" };

            // Standard mappings
            if (o.type === "rect") return { ...base, type: "rectangle", width: o.width, height: o.height };
            if (o.type === "circle") return { ...base, type: "circle", radius: o.radius };
            if (o.type === "polygon") return { ...base, type: "polygon", points: o.points.map(p => ({x: p.x, y: p.y})) };
            if (o.type === "path") return { ...base, type: "freehand", path: o.path };
            if (o.type === "i-text") return { ...base, type: "text", text: o.text, fontSize: o.fontSize };
            
            return { ...base, type: "unknown" };
          });
        
        setAnnotations(list);
    };

    saveAnnotationsRef.current = saveAnnotations;

    // --- SELECTION TRACKER ---
    const updateSelection = () => {
        const selection = canvas.getActiveObjects();
        const ids = selection.map(o => o.id);
        if (onSelectAnnotation) onSelectAnnotation(ids);
    };

    // --- BIND LISTENERS ---
    const onPathCreated = (e) => {
        e.path.set({ id: crypto.randomUUID(), selectable: false, stroke: COLORS.freehand.stroke });
        saveAnnotations();
    };

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
    };

  }, [annotations, setAnnotations, onSelectAnnotation]);

  // 3. BACKGROUND IMAGE
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !image) return;

    const url = typeof image === "string" ? image : URL.createObjectURL(image);
    
    fabric.Image.fromURL(url, (img) => {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.setWidth(img.width);
        canvas.setHeight(img.height);
        setDims({ width: img.width, height: img.height });
        
        const bg = img;
        bg.set({ selectable: false, evented: false, id: "backgroundImage" });
        canvas.setBackgroundImage(bg, () => canvas.renderAll());
    }, { crossOrigin: 'anonymous' });
  }, [image]);

  // 4. TOOL LOGIC
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.defaultCursor = "default";
    canvas.off("mouse:dblclick"); 

    const isSelect = activeTool === "select";
    canvas.getObjects().forEach((obj) => {
      if (obj.id !== "backgroundImage") {
        obj.set({ selectable: isSelect, evented: isSelect });
      }
    });

    const finishPolygon = () => {
         if (polyPoints.current.length > 2) {
            const poly = new fabric.Polygon(polyPoints.current, {
                fill: COLORS.polygon.fill, stroke: COLORS.polygon.stroke, strokeWidth: 2,
                id: crypto.randomUUID(), objectCaching: false,
                selectable: false, evented: false
            });
            canvas.add(poly);
            canvas.getObjects().filter(o => o.id === "temp-line" || o.id === "temp-point").forEach(l => canvas.remove(l));
            polyPoints.current = [];
            if (saveAnnotationsRef.current) saveAnnotationsRef.current();
         }
    };

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

    canvas.off("mouse:down");
    canvas.off("mouse:move");
    canvas.off("mouse:up");

    const onDown = (opt) => {
      const evt = opt.e;
      const pointer = canvas.getPointer(evt);

      if (activeTool === "pan") {
        isDragging.current = true;
        canvas.setCursor("grabbing");
        lastPosX.current = evt.clientX;
        lastPosY.current = evt.clientY;
        return;
      }

      if (activeTool === "select") return;

      if (activeTool === "polygon") {
         if (polyPoints.current.length > 2) {
             const startPoint = polyPoints.current[0];
             const dist = Math.hypot(pointer.x - startPoint.x, pointer.y - startPoint.y);
             if (dist < 15) { 
                 finishPolygon();
                 return;
             }
         }
         const points = polyPoints.current;
         points.push({ x: pointer.x, y: pointer.y });
         const circle = new fabric.Circle({
             left: pointer.x - 3, top: pointer.y - 3, radius: 3, 
             fill: COLORS.polygon.stroke, selectable: false, evented: false, id: "temp-point"
         });
         canvas.add(circle);
         if (points.length > 1) {
             const start = points[points.length - 2];
             const end = points[points.length - 1];
             const line = new fabric.Line([start.x, start.y, end.x, end.y], {
                 stroke: COLORS.polygon.stroke, strokeWidth: 2, selectable: false, evented: false, id: "temp-line"
             });
             canvas.add(line);
         }
         canvas.requestRenderAll();
         return; 
      }
      
      if (activeTool === "freehand") return;

      if (activeTool === "text") {
          const text = new fabric.IText("Type here", {
              left: pointer.x, top: pointer.y, fontFamily: 'Arial', 
              fill: COLORS.text.fill, fontSize: 20, id: crypto.randomUUID()
          });
          canvas.add(text);
          canvas.setActiveObject(text);
          text.enterEditing();
          text.selectAll();
          if (saveAnnotationsRef.current) saveAnnotationsRef.current();
          return;
      }

      // --- POINT CREATION ---
      if (activeTool === "point") {
          const circle = new fabric.Circle({
              left: pointer.x - 5, top: pointer.y - 5, radius: 5, 
              fill: COLORS.point.fill, 
              id: crypto.randomUUID(),
              // IMPORTANT: Tag this object so we know it's a "point" and not a "circle" later
              _customType: 'point' 
          });
          canvas.add(circle);
          if (saveAnnotationsRef.current) saveAnnotationsRef.current();
          return;
      }

      if (activeTool === "rectangle" || activeTool === "circle") {
          if (opt.target) return;
          isDragging.current = true;
          activeShape.current = null;
          const id = crypto.randomUUID();
          
          if (activeTool === "rectangle") {
            activeShape.current = new fabric.Rect({
              left: pointer.x, top: pointer.y, width: 0, height: 0,
              fill: COLORS.rectangle.fill, stroke: COLORS.rectangle.stroke, 
              strokeWidth: 2, id, selectable: false
            });
          } else {
            activeShape.current = new fabric.Circle({
              left: pointer.x, top: pointer.y, radius: 0,
              fill: COLORS.circle.fill, stroke: COLORS.circle.stroke, 
              strokeWidth: 2, id, selectable: false
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

  }, [activeTool]); 

  const manualZoom = (factor) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      let zoom = canvas.getZoom();
      zoom *= factor;
      if(zoom > 20) zoom = 20; if(zoom < 0.1) zoom = 0.1;
      const center = canvas.getCenter();
      canvas.zoomToPoint({ x: center.left, y: center.top }, zoom);
  }

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
                        if(onSelectAnnotation) onSelectAnnotation([]);
                    }} 
                    className="bg-white p-2 rounded-full shadow text-red-500 hover:bg-red-50"
                    title="Close Image"
                >
                    <X size={20} />
                </button>

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
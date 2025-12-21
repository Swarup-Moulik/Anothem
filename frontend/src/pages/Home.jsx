import { useState, useCallback, useEffect, useRef } from "react";
import {
  Download,
  Save,
  FolderOpen,
  X,
  Trash2,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import ToolBar from "../components/Toolbar.jsx";
import AnnotationCanvas from "../components/AnnotationCanvas.jsx";
import Sidebar from "../components/Sidebar.jsx";

const API_URL = import.meta.env.VITE_API_URL;

const Home = () => {
  const [image, setImage] = useState(null); // { id, url, name } - id absent for local-only images
  const [unsavedFile, setUnsavedFile] = useState(null); // store the File until Save
  const [activeTool, setActiveTool] = useState("select");
  const [labels, setLabels] = useState(["Person", "Car", "Building"]);
  const [selectedIds, setSelectedIds] = useState([]);

  // Gallery State
  const [showGallery, setShowGallery] = useState(false);
  const [savedImages, setSavedImages] = useState([]);

  // --- MOBILE STATE ---
  const [showMobileToolbar, setShowMobileToolbar] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Swipe Gesture Refs
  const touchStart = useRef(null);
  const touchEnd = useRef(null);
  const minSwipeDistance = 50; // px

  // History State
  const [history, setHistory] = useState([[]]);
  const [currentStep, setCurrentStep] = useState(0);
  const currentStepRef = useRef(currentStep);
  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  const annotations = history[currentStep] ?? [];

  // --- SWIPE HANDLERS ---
  const onTouchStart = (e) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  };

  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      if (showMobileToolbar) setShowMobileToolbar(false);
      else setShowMobileSidebar(true);
    }
    if (isRightSwipe) {
      if (showMobileSidebar) setShowMobileSidebar(false);
      else setShowMobileToolbar(true);
    }
  };

  // --- 1. SELECT IMAGE (client-side only) ---
  // This no longer uploads immediately. It keeps the file client-side until Save.
  const handleLocalSelectImage = (file) => {
    if (!file) return;
    // Revoke previous unsaved preview if any
    if (unsavedFile?.previewUrl) URL.revokeObjectURL(unsavedFile.previewUrl);

    const previewUrl = URL.createObjectURL(file);
    setUnsavedFile({ file, previewUrl });
    // image state stores a local preview and no id (so Save will trigger upload)
    setImage({ id: null, url: previewUrl, name: file.name });
    // reset annotation history for new image
    setHistory([[]]);
    setCurrentStep(0);
    setSelectedIds([]);
  };

  // --- 2. UPLOAD IMAGE helper (used by Save) ---
  const uploadImageToServer = async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(`${API_URL}/images/upload`, {
      method: "POST",
      body: formData,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "Upload failed");
      throw new Error(txt || "Upload failed");
    }
    return resp.json(); // expect { id, public_url, filename, ... }
  };

  // --- 3. LOAD ANNOTATIONS (only when image.id exists on server) ---
  useEffect(() => {
    if (!image?.id) return; // do not fetch annotations for local-only images
    const fetchAnnotations = async () => {
      try {
        const response = await fetch(`${API_URL}/annotations/${image.id}`);
        if (response.ok) {
          const savedData = await response.json();
          setHistory([savedData || []]);
          setCurrentStep(0);
        }
      } catch (error) {
        console.error("Error loading:", error);
      }
    };
    fetchAnnotations();
  }, [image?.id]);

  // --- 4. GALLERY LOGIC ---
  const fetchGallery = async () => {
    try {
      const response = await fetch(`${API_URL}/images/`);
      if (response.ok) {
        const data = await response.json();
        setSavedImages(data);
      }
    } catch (error) {
      console.error("Gallery Error:", error);
    }
  };

  const handleOpenGallery = () => {
    fetchGallery();
    setShowGallery(true);
  };

  const handleLoadProject = (imgData) => {
    // If a local preview was present, revoke it and clear unsavedFile
    if (unsavedFile?.previewUrl) URL.revokeObjectURL(unsavedFile.previewUrl);
    setUnsavedFile(null);

    setImage({
      id: imgData.id,
      url: imgData.public_url,
      name: imgData.filename,
    });
    setShowGallery(false);
    // annotations will be loaded by the effect that watches image.id
  };

  // --- DELETE PROJECT ---
  const handleDeleteProject = async (e, imgId) => {
    e.stopPropagation();
    if (
      !window.confirm(
        "Are you sure you want to delete this project? This cannot be undone."
      )
    )
      return;

    try {
      const response = await fetch(`${API_URL}/images/${imgId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setSavedImages((prev) => prev.filter((img) => img.id !== imgId));
        if (image?.id === imgId) {
          setImage(null);
          setHistory([[]]);
          setCurrentStep(0);
        }
      } else {
        alert("Failed to delete project.");
      }
    } catch (error) {
      console.error("Delete Error:", error);
      alert("Error deleting project.");
    }
  };

  // --- SAVE & EXPORT ---
  const handleSave = async () => {
    // If no image at all
    if (!image) {
      toast.error("No image loaded!");
      return;
    }

    // If image not yet uploaded (local preview), upload first, then save annotations
    const doSave = async () => {
      try {
        let serverImage = image;

        if (!image.id) {
          // Need to upload local file
          if (!unsavedFile?.file) throw new Error("No local file to upload.");
          const uploadToast = toast.loading("Uploading image...");
          try {
            const uploaded = await uploadImageToServer(unsavedFile.file);
            // uploaded expected: { id, public_url, filename, ... }
            serverImage = {
              id: uploaded.id,
              url: uploaded.public_url,
              name: uploaded.filename,
            };
            setImage(serverImage);
            // clean up local preview (we now use server URL)
            if (unsavedFile?.previewUrl)
              URL.revokeObjectURL(unsavedFile.previewUrl);
            setUnsavedFile(null);
            toast.success("Image uploaded!", { id: uploadToast });
          } catch (err) {
            toast.error("Image upload failed.", { id: uploadToast });
            throw err;
          }
        }

        // Now save annotations to server for serverImage.id
        const saveToast = toast.loading("Saving annotations...");
        const resp = await fetch(`${API_URL}/annotations/${serverImage.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: annotations }),
        });
        if (!resp.ok) {
          throw new Error("Failed to save annotations");
        }
        toast.success("Project saved successfully!", { id: saveToast });
      } catch (err) {
        console.error("Save error:", err);
        toast.error("Failed to save project.");
      }
    };

    // run save
    await doSave();
  };

  const downloadFile = (content, fileName, contentType) => {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleExport = () => {
    if (annotations.length === 0) {
      toast.error("No annotations to export!");
      return;
    }
    const cleanData = annotations.map((a) => {
      let shapeData = {};
      if (a.type === "rectangle" || a.type === "circle") {
        shapeData = {
          x: Math.round(a.x),
          y: Math.round(a.y),
          width: Math.round(a.width * (a.scaleX || 1)),
          height: Math.round(a.height * (a.scaleY || 1)),
        };
      } else if (a.type === "polygon") {
        shapeData = { points: a.points };
      } else if (a.type === "point") {
        shapeData = { x: Math.round(a.x), y: Math.round(a.y) };
      }
      return {
        id: a.id,
        label: a.label || "Unlabeled",
        type: a.type,
        ...shapeData,
      };
    });
    const fileName = image?.name
      ? `export_${image.name.split(".")[0]}.json`
      : "annotations_export.json";
    downloadFile(
      JSON.stringify(cleanData, null, 2),
      fileName,
      "application/json"
    );
    toast.success("Data exported successfully!");
  };

  // --- HELPERS ---
  const handleSetAnnotations = useCallback((newAnnotations) => {
    setHistory((prevHistory) => {
      const base = prevHistory.slice(0, currentStepRef.current + 1);
      base.push(JSON.parse(JSON.stringify(newAnnotations || [])));
      return base;
    });
    setCurrentStep((prev) => prev + 1);
  }, []);

  const handleUndo = () => {
    if (currentStep > 0) setCurrentStep((p) => p - 1);
  };
  const handleRedo = () => {
    if (currentStep < history.length - 1) setCurrentStep((p) => p + 1);
  };
  const handleDeleteAnnotation = () => {
    if (selectedIds.length === 0) {
      toast.error("Select an annotation first.");
      return;
    }
    const remaining = annotations.filter((a) => !selectedIds.includes(a.id));
    if (remaining.length !== annotations.length) {
      handleSetAnnotations(remaining);
      setSelectedIds([]);
      toast.success("Annotation deleted");
    }
  };

  // cleanup local preview URL on unmount
  useEffect(() => {
    return () => {
      if (unsavedFile?.previewUrl) URL.revokeObjectURL(unsavedFile.previewUrl);
    };
  }, [unsavedFile]);

  return (
    <div className="bg-gray-50 h-screen flex flex-col relative">
      <Toaster position="top-center" reverseOrder={false} />
      <header className="flex justify-between items-center px-1 md:px-4 py-2 border-b border-gray-300 bg-white shrink-0 gap-2">
        <div className="flex items-center md:gap-3">
          {/* Mobile Toggle: Toolbar */}
          <button
            className="md:hidden p-2 hover:bg-gray-100 rounded"
            onClick={() => setShowMobileToolbar(!showMobileToolbar)}
          >
            <PanelLeft size={20} />
          </button>
          <div className="text-lg md:text-3xl font-bold text-gray-800 truncate">
            Annothem
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4 text-sm md:text-md">
          <button
            onClick={handleOpenGallery}
            className="flex gap-2 items-center bg-white hover:bg-gray-50 border border-gray-300 px-3 py-2 rounded-lg transition-colors text-gray-700 font-medium cursor-pointer"
          >
            <FolderOpen size={20} /> Projects
          </button>
          <button
            onClick={handleSave}
            className="flex gap-2 items-center bg-gray-100 hover:bg-gray-200 border border-gray-300 px-3 py-2 rounded-lg transition-colors cursor-pointer"
          >
            <Save size={20} /> <span className="text-sm font-medium">Save</span>
          </button>
          <button
            onClick={handleExport}
            className="flex gap-2 items-center bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 px-3 py-2 rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <Download size={20} />{" "}
            <span className="text-sm font-medium">Export</span>
          </button>
          {/* Mobile Toggle: Sidebar */}
          <button
            className="md:hidden p-2 hover:bg-gray-100 rounded"
            onClick={() => setShowMobileSidebar(!showMobileSidebar)}
          >
            <PanelRight size={20} />
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main
        className="flex flex-1 relative overflow-hidden h-full"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* --- TOOLBAR (Responsive) --- */}
        <div
          className={`
            fixed md:static inset-y-0 left-0 z-40 w-16 md:m-4
            transform transition-transform duration-300 ease-in-out shadow-xl md:shadow-none
            ${
              showMobileToolbar
                ? "translate-x-0"
                : "-translate-x-full md:translate-x-0"
            }
        `}
        >
          <ToolBar
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDelete={handleDeleteAnnotation}
            canUndo={currentStep > 0}
            canRedo={currentStep < history.length - 1}
          />
        </div>

        {/* --- CANVAS AREA --- */}
        <div className="flex-1 relative overflow-hidden p-2 md:p-4">
          <AnnotationCanvas
            image={image ? image.url : null}
            // setImage receives either File or null (to close). If File -> keep locally (no upload).
            setImage={(fileOrNull) => {
              if (fileOrNull instanceof File)
                handleLocalSelectImage(fileOrNull);
              else if (fileOrNull === null) {
                // user closed canvas; revoke local preview if any
                if (unsavedFile?.previewUrl)
                  URL.revokeObjectURL(unsavedFile.previewUrl);
                setUnsavedFile(null);
                setImage(null);
                setHistory([[]]);
                setCurrentStep(0);
                setSelectedIds([]);
              }
            }}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            annotations={annotations}
            setAnnotations={handleSetAnnotations}
            onSelectAnnotation={setSelectedIds}
          />
        </div>

        {/* --- SIDEBAR (Responsive) --- */}
        <div
          className={`
            fixed md:static inset-y-0 right-0 z-40 w-90 md:m-4
            max-h-screen flex flex-col min-h-0
            transform transition-transform duration-300 ease-in-out
            shadow-xl md:shadow-none
            ${
              showMobileSidebar
                ? "translate-x-0"
                : "translate-x-full md:translate-x-0"
            }
        `}
        >
          <Sidebar
            labels={labels}
            setLabels={setLabels}
            annotations={annotations}
            setAnnotations={handleSetAnnotations}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
          />
        </div>

        {(showMobileToolbar || showMobileSidebar) && (
          <div
            className="fixed inset-0 bg-black/20 z-30 md:hidden"
            onClick={() => {
              setShowMobileToolbar(false);
              setShowMobileSidebar(false);
            }}
          />
        )}
      </main>

      {/* --- GALLERY MODAL --- */}
      {showGallery && (
        <div className="absolute inset-0 bg-black/50 flex justify-center items-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-3/4 h-3/4 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <FolderOpen size={24} className="text-blue-600" /> Your Projects
              </h2>
              <button
                onClick={() => setShowGallery(false)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors cursor-pointer"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto bg-gray-100 grow">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {savedImages.map((img) => (
                  <div
                    key={img.id}
                    onClick={() => handleLoadProject(img)}
                    className="group bg-white rounded-lg border shadow-sm hover:shadow-md cursor-pointer overflow-hidden transition-all hover:ring-2 ring-blue-500 relative"
                  >
                    <button
                      onClick={(e) => handleDeleteProject(e, img.id)}
                      className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full text-gray-500 hover:text-red-600 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer"
                      title="Delete Project"
                    >
                      <Trash2 size={16} />
                    </button>

                    <div className="h-40 overflow-hidden bg-gray-200 flex justify-center items-center relative">
                      <img
                        src={img.public_url}
                        alt={img.filename}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>
                    <div className="p-4">
                      <p
                        className="font-medium text-sm text-gray-800 truncate"
                        title={img.filename}
                      >
                        {img.filename}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(img.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
                {savedImages.length === 0 && (
                  <div className="col-span-full flex flex-col items-center justify-center text-gray-400 py-20">
                    <FolderOpen size={48} className="mb-4 opacity-20" />
                    <p>No saved projects found.</p>
                    <p className="text-sm">Upload an image to get started!</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;

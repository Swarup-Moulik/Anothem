import { Plus, Tag, Trash2, MousePointer2 } from 'lucide-react';

const Sidebar = ({ 
  labels, 
  setLabels, 
  annotations, 
  setAnnotations, // Needed to update the annotation with a label
  selectedIds,    // Needed to know which shape to label
  onSelect        // Needed to select a shape from the list
}) => {

  const handleAddLabel = () => {
    const newLabel = prompt('Enter new label name:');
    if (newLabel && !labels.includes(newLabel)) {
      setLabels([...labels, newLabel]);
    } else if (labels.includes(newLabel)) {
      alert('Label already exists!');
    }
  };

  // --- CORE LOGIC: Assign Label to Selected Shapes ---
  const handleLabelClick = (label) => {
    if (selectedIds.length === 0) {
      alert("Please select an annotation on the canvas first!");
      return;
    }

    // Update the annotations list
    const updatedAnnotations = annotations.map((anno) => {
      // If this annotation is currently selected, add/update the 'label' property
      if (selectedIds.includes(anno.id)) {
        return { ...anno, label: label };
      }
      return anno;
    });

    setAnnotations(updatedAnnotations);
  };

  // Helper: Delete specific item from list
  const deleteSingle = (e, id) => {
    e.stopPropagation(); // Prevent triggering selection
    const updated = annotations.filter(a => a.id !== id);
    setAnnotations(updated);
  };

  const formatType = (type) => {
      if(!type) return 'Shape';
      return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <div className='w-80 shrink-0 bg-white border-l border-gray-300 p-4 flex flex-col h-full shadow-sm'> 
      
      {/* --- LABELS SECTION --- */}
      <div className='mb-6 border-b pb-2'>
        <div className='flex justify-between items-center mb-3'>
          <h3 className='text-lg font-bold text-gray-800 flex items-center gap-2'>
            <Tag size={18} /> Labels
          </h3>
          <button 
            onClick={handleAddLabel}
            className='flex items-center gap-1 bg-blue-50 text-blue-600 px-3 py-1 rounded hover:bg-blue-100 transition-colors text-sm font-medium cursor-pointer'
          >
            <Plus size={14} /> New
          </button>
        </div>
        
        <div className='flex flex-wrap gap-2'>
          {labels.length > 0 ? (
            labels.map((label) => (
              <button
                key={label}
                onClick={() => handleLabelClick(label)}
                className='px-3 py-1 rounded-full text-sm border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-all cursor-pointer'
                title="Click to assign to selected shape"
              >
                {label}
              </button>
            ))
          ) : (
            <p className='text-sm text-gray-400 italic'>No labels yet.</p>
          )}
        </div>
        <p className='text-sm text-gray-400 mt-3'>
          Select a shape, then click a label to apply it.
        </p>
      </div>   
      
      {/* --- ANNOTATIONS LIST SECTION --- */}
      <div className="grow overflow-hidden flex flex-col">
        <h3 className='text-lg font-bold text-gray-800 mb-3 flex items-center gap-2'>
           Annotations <span className="text-gray-400 text-sm font-normal">({annotations.length})</span>
        </h3>
        
        <div className='space-y-2 overflow-y-auto pr-2 custom-scrollbar'>
          {annotations.length > 0 ? (
            annotations.map((annotation, index) => {
              const isSelected = selectedIds.includes(annotation.id);
              return (
                <div 
                  key={annotation.id} 
                  onClick={() => onSelect([annotation.id])} // Sync selection
                  className={`
                    group p-3 border rounded-lg flex justify-between items-center cursor-pointer transition-all
                    ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}
                  `}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${isSelected ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'}`}>
                        {index + 1}
                      </span>
                      <span className="font-medium text-gray-700 text-sm">
                        {formatType(annotation.type)}
                      </span>
                    </div>
                    
                    {/* Show Assigned Label */}
                    {annotation.label && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-blue-600">
                        <Tag size={10} /> {annotation.label}
                      </div>
                    )}
                    
                    {/* Show Text Content (if it's a text tool) */}
                    {annotation.type === 'text' && (
                        <span className="text-xs text-gray-500 italic mt-0.5 truncate max-w-[150px]">
                            "{annotation.text}"
                        </span>
                    )}
                  </div>

                  {/* Delete Button (Visible on Hover or Selected) */}
                  <button 
                    onClick={(e) => deleteSingle(e, annotation.id)}
                    className={`
                      p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer
                      ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                    `}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
              <MousePointer2 size={32} className="mb-2 opacity-20" />
              <p className='text-sm'>No annotations yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
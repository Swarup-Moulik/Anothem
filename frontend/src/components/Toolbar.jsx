import {
  MousePointer2,
  Circle,
  Square,
  Pentagon,
  Pencil,
  Type,
  Dot,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  Plus,
  Minus
} from 'lucide-react';

const ToolButton = ({ icon, label, onClick, isActive, disabled }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-3 rounded-lg flex justify-center items-center transition-all  ${isActive
          ? 'bg-blue-100 text-blue-700 shadow-inner'
          : disabled
            ? 'text-gray-300 cursor-not-allowed'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 cursor-pointer'
        }`}
      title={label}
    >
      {icon}
    </button>
  );
};

const ToolBar = ({
  activeTool,
  setActiveTool,
  onUndo,
  onRedo,
  onDelete,
  canUndo,
  canRedo
}) => {
  return (
    <div className='w-16 shrink-0 border bg-white border-gray-300 rounded-lg py-4 flex flex-col gap-2 shadow-sm'>

      {/* SELECTION & NAVIGATION */}
      <div className="flex flex-col gap-1 px-2">
        <ToolButton
          icon={<MousePointer2 size={20} />}
          label='Select / Edit'
          isActive={activeTool === 'select'}
          onClick={() => setActiveTool('select')}
        />
        <ToolButton
          icon={<Hand size={20} />}
          label='Pan Tool (Drag to move)'
          isActive={activeTool === 'pan'}
          onClick={() => setActiveTool('pan')}
        />
      </div>

      <div className='border-b border-gray-900 mx-4 my-1'></div>

      {/* DRAWING TOOLS */}
      <div className="flex flex-col gap-1 px-2">
        <ToolButton
          icon={<Square size={20} />}
          label='Rectangle'
          isActive={activeTool === 'rectangle'}
          onClick={() => setActiveTool('rectangle')}
        />
        <ToolButton
          icon={<Circle size={20} />}
          label='Circle'
          isActive={activeTool === 'circle'}
          onClick={() => setActiveTool('circle')}
        />
        <ToolButton
          icon={<Pentagon size={20} />}
          label='Polygon (Double click to finish)'
          isActive={activeTool === 'polygon'}
          onClick={() => setActiveTool('polygon')}
        />
        <ToolButton
          icon={<Pencil size={20} />}
          label='Freehand'
          isActive={activeTool === 'freehand'}
          onClick={() => setActiveTool('freehand')}
        />
        <ToolButton
          icon={<Dot size={20} />}
          label='Point'
          isActive={activeTool === 'point'}
          onClick={() => setActiveTool('point')}
        />
        <ToolButton
          icon={<Type size={20} />}
          label='Text'
          isActive={activeTool === 'text'}
          onClick={() => setActiveTool('text')}
        />
      </div>

      <div className='border-b border-gray-900 mx-4 my-1'></div>

      {/* VERTEX EDITING */}
      <div className="flex flex-col gap-1 px-2">
        <ToolButton
          icon={<Plus size={18} />}
          label='Add Vertex (click edge)'
          isActive={activeTool === 'add-vertex'}
          onClick={() => setActiveTool('add-vertex')}
        />
        <ToolButton
          icon={<Minus size={18} />}
          label='Remove Vertex (click vertex)'
          isActive={activeTool === 'delete-vertex'}
          onClick={() => setActiveTool('delete-vertex')}
        />
      </div>

      <div className='border-b border-gray-900 mx-4 my-1'></div>

      {/* HISTORY */}
      <div className="flex flex-col gap-1 px-2">

        <ToolButton
          icon={<Trash2 size={20} />}
          label='Delete Selected'
          onClick={onDelete}
        />

        <div className='border-b border-gray-900 mx-4 my-1'></div>

        <ToolButton
          icon={<Undo2 size={20} />}
          label='Undo'
          onClick={onUndo}
          disabled={!canUndo}
        />
        <ToolButton
          icon={<Redo2 size={20} />}
          label='Redo'
          onClick={onRedo}
          disabled={!canRedo}
        />
      </div>

    </div>
  );
};

export default ToolBar;

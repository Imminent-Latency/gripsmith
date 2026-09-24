import React, { useState } from "react";
import { GeometrySettings } from "../../types/schemas";
import {
  BookOpen,
  Grid3x3,
  MousePointer2,
  Maximize,
} from "lucide-react";
import SwatchGrid from "../ui/SwatchGrid";
import ShapeUploader from "../ShapeUploader";
import SegmentedControl from "../ui/SegmentedControl";
import PatternLibraryModal from "../PatternLibraryModal";
import { useAlert } from "../../context/AlertContext";
import { STLLoader } from "three-stdlib";
import { getShapesBounds } from "../../utils/patternUtils";
import { parseShapeFile } from "../../utils/shapeLoader";
import ParamField from "../params/ParamField";
import { useParamContext } from "../../context/ParamContext";
import { geometrySections } from "../params/descriptors/geometry";

interface GeometryControlsProps {
  settings: GeometrySettings;
  updateSettings: (updates: Partial<GeometrySettings>) => void;
  baseSize: number;
  onPatternAssetChanged?: (asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => void;
}

const GeometryControls: React.FC<GeometryControlsProps> = ({
  settings,
  updateSettings,
  baseSize,
  onPatternAssetChanged,
}) => {
  const { showAlert } = useAlert();
  const paramContext = useParamContext();
  const {
    patternShapes,
    patternType,
    patternScale,
    patternScaleZ,
    isTiled,
    patternMargin,
    patternColor,
  } = settings;

  const [showPatternLibrary, setShowPatternLibrary] = useState(false);
  const [libraryPatternName, setLibraryPatternName] = useState<string | null>(
    null
  );

  React.useEffect(() => {
    if (!patternShapes || patternShapes.length === 0) {
      setLibraryPatternName(null);
    }
  }, [patternShapes]);

  // Re-implement calculation logic locally or import if available
  const calculateAutoPatternScale = (
    shapes: any[],
    type: string | null,
    tiled: boolean,
    bSize: number,
    margin: number
  ): number | null => {
    if (!shapes || shapes.length === 0) return null;

    let width = 0;
    let height = 0;

    if (type === "stl") {
      const geometry = shapes[0];
      if (geometry.boundingBox === null) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      width = bounds.max.x - bounds.min.x;
      height = bounds.max.y - bounds.min.y;
    } else {
      const bounds = getShapesBounds(shapes);
      width = bounds.size.x;
      height = bounds.size.y;
    }

    if (width <= 0 || height <= 0) return null;

    if (tiled) {
      // Tiled: Target ~xmm width
      const targetWidth = 10;
      const rawScale = targetWidth / width;
      const scale = Math.round(rawScale * 100) / 100;
      return scale > 0 ? scale : 1;
    } else {
      // Place: Target 50% of base size minus margin
      // DXF was previously hardcoded to 1, but we now allow auto-scale for better UX
      const maxSize = Math.max(width, height);
      if (maxSize > 0) {
        const availableSize = Math.max(0, bSize - margin * 2);
        // Target 50% coverage of the available area
        const scale = (availableSize * 0.5) / maxSize;
        const roundedScale = Math.round(scale * 100) / 100;
        return roundedScale > 0 ? roundedScale : 1;
      }
    }
    return 1;
  };

  const handlePatternLoaded = (shapes: any[], type?: "dxf" | "svg" | "stl", name?: string, content?: string | ArrayBuffer) => {
    const pType = type || null;
    const newScale = calculateAutoPatternScale(
      shapes,
      pType,
      isTiled,
      baseSize,
      patternMargin
    );

    console.log("[GeometryControls] Pattern Loaded:", {
      type,
      isTiled,
      newScale,
      shapeCount: shapes.length,
      name
    });

    updateSettings({
      patternShapes: shapes,
      patternType: pType,
      ...(newScale !== null ? { patternScale: newScale } : {}),
    });

    if (onPatternAssetChanged && name && content && type) {
        onPatternAssetChanged({ name, content, type });
    }
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <ShapeUploader
        label="Grip Geometry"
        shapes={
          patternShapes && patternShapes.length > 0 ? patternShapes : null
        }
        fileName={libraryPatternName}
        onUpload={(shapes, name, type, content) => {
          handlePatternLoaded(shapes, type, name, content);
          setLibraryPatternName(name);
        }}
        onClear={() => {
          updateSettings({
            patternShapes: [],
            patternType: null,
          });
          setLibraryPatternName(null);
          if (onPatternAssetChanged) onPatternAssetChanged(null);
        }}
        allowedTypes={["stl"]}
        adornment={
          <button
            onClick={() => setShowPatternLibrary(true)}
            className={
              "p-1 rounded-lg transition-colors border bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500"
            }
            title="Open Pattern Library"
          >
            <BookOpen size={12} />
          </button>
        }
      />

      <PatternLibraryModal
        isOpen={showPatternLibrary}
        onClose={() => setShowPatternLibrary(false)}
        onSelect={async (preset) => {
          setShowPatternLibrary(false);
          try {
            if (preset.type === "stl") {
               const response = await fetch(`/${preset.category}/${preset.file}`);
               const buffer = await response.arrayBuffer();
               
              const loader = new STLLoader();
              const geometry = loader.parse(buffer);
              geometry.center(); // Auto-center STLs
              handlePatternLoaded([geometry], preset.type, preset.name, buffer);

            } else {
               // For DXF/SVG, we need text content
               const response = await fetch(`/${preset.category}/${preset.file}`);
               const text = await response.text();
               
               const result = parseShapeFile(text, preset.type as 'dxf' | 'svg');
               if (result.success) {
                   handlePatternLoaded(result.shapes, preset.type, preset.name, text);
               } else {
                   console.error("Failed to parse library pattern:", result.error);
               }
            }

            setLibraryPatternName(preset.name);
          } catch (error) {
            console.error("Failed to load pattern:", error);
            showAlert({
              title: "Error Loading Pattern",
              message: "Failed to load the selected pattern preset.",
              type: "error",
            });
          }
        }}
      />

      {patternShapes && patternShapes.length > 0 && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              Layout Mode
            </label>
            <SegmentedControl
              value={isTiled ? "tile" : "place"}
              onChange={(val) => {
                const newIsTiled = val === "tile";
                const newScale = calculateAutoPatternScale(
                  patternShapes,
                  patternType,
                  newIsTiled,
                  baseSize,
                  patternMargin
                );

                updateSettings({
                  isTiled: newIsTiled,
                  ...(newScale !== null ? { patternScale: newScale } : {}),
                });
              }}
              options={[
                { value: "tile", label: "Tile", icon: <Grid3x3 size={16} /> },
                {
                  value: "place",
                  label: "Place",
                  icon: <MousePointer2 size={16} />,
                },
              ]}
            />
          </div>

          {geometrySections.filter(section => !section.visible || section.visible(paramContext)).map((section, index) => (
            <div key={index} className={section.className}>
              {section.fields.filter(descriptor => !descriptor.visible || descriptor.visible(paramContext)).map(descriptor => (
                <div key={descriptor.key} className="space-y-2 flex-1 min-w-0">
                  <ParamField descriptor={descriptor} settings={settings} ctx={paramContext}
                    onChange={updates => {
                      if (updates.patternScale !== undefined && patternScaleZ !== "" && patternScale > 0) {
                        const ratio = updates.patternScale / patternScale;
                        updates.patternScaleZ = Math.round(Number(patternScaleZ) * ratio * 1000) / 1000;
                      }
                      updateSettings(updates);
                    }}
                    action={descriptor.key === 'patternScale' && patternShapes && patternShapes.length > 0 && (
                      <button
                        onClick={() => {
                          const newScale = calculateAutoPatternScale(patternShapes, patternType, isTiled, baseSize, patternMargin);
                          if (newScale !== null) updateSettings({ patternScale: newScale });
                        }}
                        className="text-gray-400 hover:text-purple-400 transition-colors"
                        title={isTiled ? "Auto Scale Tile Pattern" : "Auto Scale to Fit"}
                      >
                        <Maximize size={14} />
                      </button>
                    )}
                  />
                </div>
              ))}
            </div>
          ))}

          <SwatchGrid value={patternColor} onChange={value => updateSettings({ patternColor: value })} className="pt-2 border-t border-gray-800" />
        </>
      )}
    </section>
  );
};

export default GeometryControls;

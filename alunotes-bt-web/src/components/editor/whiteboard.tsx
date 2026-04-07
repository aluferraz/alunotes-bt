"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { Sun, Moon, Maximize2, Minimize2 } from "lucide-react";
import { useUIPreferences } from "~/stores/ui-preferences";
import { useWhiteboardStore } from "~/stores/whiteboard";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false }
);

interface WhiteboardProps {
  initialElements?: ExcalidrawElement[];
  initialAppState?: AppState;
  onChange?: (elements: readonly ExcalidrawElement[], appState: AppState) => void;
}

export function WhiteboardEditor({ initialElements, initialAppState, onChange }: WhiteboardProps) {
  const [mounted, setMounted] = useState(false);
  const boardTheme = useUIPreferences((s) => s.whiteboardTheme);
  const toggleBoardTheme = useUIPreferences((s) => s.toggleWhiteboardTheme);
  const isFullscreen = useWhiteboardStore((s) => s.isFullscreen);
  const toggleFullscreen = useWhiteboardStore((s) => s.toggleFullscreen);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFullscreen();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isFullscreen, toggleFullscreen]);

  if (!mounted) return <div className="w-full h-full bg-glass-bg animate-pulse rounded-2xl" />;

  return (
    <div
      className={`excalidraw-container w-full h-full rounded-2xl overflow-hidden glass-border shadow-glass-lg ${
        isFullscreen ? "rounded-3xl" : ""
      }`}
      style={{ height: isFullscreen ? "100%" : "70vh" }}
    >
      <Excalidraw
        initialData={{
          elements: initialElements,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
          appState: { ...initialAppState, collaborators: new Map() } as any,
        }}
        theme={boardTheme}
        onChange={(elements, appState) => {
          onChange?.(elements, appState);
        }}
        renderTopRightUI={() => (
          <div className="flex items-center gap-1">
            <button
              onClick={toggleBoardTheme}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--color-surface-low)] transition-colors"
              title={`Switch to ${boardTheme === "dark" ? "light" : "dark"} mode`}
            >
              {boardTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={toggleFullscreen}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--color-surface-low)] transition-colors"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        )}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: true,
            loadScene: false,
            toggleTheme: false,
          },
        }}
      />
    </div>
  );
}
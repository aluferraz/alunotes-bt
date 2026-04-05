"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

// Must be loaded dynamically since it interacts directly with window
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
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="w-full h-full bg-glass-bg animate-pulse rounded-2xl" />;

  return (
    <div className="excalidraw-container w-full h-full rounded-2xl overflow-hidden glass-border shadow-glass-lg" style={{ height: "70vh" }}>
      <Excalidraw
        initialData={{
          elements: initialElements,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
          appState: { ...initialAppState, collaborators: new Map() } as any,
        }}
        theme={theme === "dark" ? "dark" : "light"}
        onChange={(elements, appState) => {
          onChange?.(elements, appState);
        }}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: true,
            loadScene: false,
            toggleTheme: false, // We control it via Next-themes
          },
        }}
      />
    </div>
  );
}

"use client";

import { use, useEffect, useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { orpc } from "~/orpc/react";
import { WhiteboardEditor } from "~/components/editor/whiteboard";
import { Save, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { debounce } from "lodash";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export default function WhiteboardViewPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const boardId = params.id;
  
  const { data: board, isLoading } = useQuery(orpc.whiteboard.get.queryOptions({ input: { id: boardId } }));
  const { mutate: updateBoard, isPending: isSaving } = useMutation(orpc.whiteboard.update.mutationOptions());

  const [name, setName] = useState("");
  const [elements, setElements] = useState<ExcalidrawElement[] | null>(null);
  const [appState, setAppState] = useState<Partial<AppState> | null>(null);

  // Sync initial
  useEffect(() => {
    if (board && name === "" && elements === null) {
      setName(board.name);
      setElements(board.elements ? JSON.parse(board.elements) : []);
      setAppState(board.appState ? JSON.parse(board.appState) : {});
    }
  }, [board, name, elements]);

  // Debounced auto-save
  const debouncedSave = useMemo(
    () =>
      debounce((newName: string, elStr: string, stateStr: string) => {
        updateBoard({ id: boardId, name: newName, elements: elStr, appState: stateStr });
      }, 1500),
    [boardId, updateBoard]
  );

  const handleChange = useCallback(
    (newElements: readonly ExcalidrawElement[], newAppState: AppState) => {
      // Excalidraw elements is readonly, just cast to mute TS error
      const elArr = [...newElements] as ExcalidrawElement[];
      
      debouncedSave(name, JSON.stringify(elArr), JSON.stringify(newAppState));
    },
    [debouncedSave, name]
  );

  const handleUpdateName = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    // Elements and appState might be null initially, provide fallback
    debouncedSave(newName, JSON.stringify(elements || []), JSON.stringify(appState || {}));
  };

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!board) return <div className="text-center text-muted-foreground mt-20">Board not found.</div>;

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto min-h-screen">
      <div className="flex items-center justify-between sticky top-0 z-20 py-4 mb-4 bg-background/50 backdrop-blur-xl border-b border-white/5 -mx-4 px-4 sm:mx-0 sm:px-0 sm:bg-transparent sm:backdrop-blur-none sm:border-none">
        <div className="flex items-center gap-4">
          <Link href="/whiteboard" className="flex items-center justify-center p-2 rounded-xl text-muted-foreground hover:bg-glass-border hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <input
            type="text"
            value={name}
            onChange={handleUpdateName}
            placeholder="Canvas Name"
            className="text-2xl font-manrope font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/30 px-0 focus:ring-0 max-w-[200px] sm:max-w-xs"
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-glass-bg border border-glass-border backdrop-blur-md text-xs font-medium text-muted-foreground">
          {isSaving ? (
            <><Loader2 className="w-3 h-3 animate-spin"/> Saving...</>
          ) : (
             <><Save className="w-3 h-3"/> Saved</>
          )}
        </div>
      </div>

      {elements !== null && (
        <WhiteboardEditor 
          initialElements={elements} 
          initialAppState={appState as AppState}
          onChange={handleChange}
        />
      )}
    </div>
  );
}

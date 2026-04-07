"use client";

import { use, useEffect, useCallback, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAsyncDebouncer } from "@tanstack/react-pacer";
import { useRouter } from "next/navigation";
import { orpc } from "~/orpc/react";
import { useWhiteboardStore } from "~/stores/whiteboard";
import { WhiteboardEditor } from "~/components/editor/whiteboard";
import { Save, ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export default function WhiteboardViewPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const boardId = params.id;

  const queryClient = useQueryClient();
  const { data: board, isLoading } = useQuery(orpc.whiteboard.get.queryOptions({ input: { id: boardId } }));
  const { mutateAsync: updateBoard } = useMutation(orpc.whiteboard.update.mutationOptions());
  const updateBoardRef = useRef(updateBoard);
  useEffect(() => { updateBoardRef.current = updateBoard; }, [updateBoard]);

  const { name, elements, appState, isFullscreen } = useWhiteboardStore();
  const initialize = useWhiteboardStore((s) => s.initialize);
  const setName = useWhiteboardStore((s) => s.setName);
  const toggleFullscreen = useWhiteboardStore((s) => s.toggleFullscreen);
  const hasElementsChanged = useWhiteboardStore((s) => s.hasElementsChanged);
  const reset = useWhiteboardStore((s) => s.reset);

  // Keep latest elements/appState in refs so saves always use freshest data
  const latestElementsRef = useRef<string>("[]");
  const latestAppStateRef = useRef<string>("{}");
  const wasEditingTextRef = useRef(false);

  // Sync initial data from server
  useEffect(() => {
    if (board) {
      initialize(board);
      latestElementsRef.current = board.elements ?? "[]";
      latestAppStateRef.current = board.appState ?? "{}";
    }
  }, [board, initialize]);

  // Reset store on unmount so next board starts fresh
  useEffect(() => () => reset(), [reset]);

  // Stable save function — invalidates query cache after success
  const saveFn = useCallback(
    async (newName: string, elStr: string, stateStr: string) => {
      await updateBoardRef.current({ id: boardId, name: newName, elements: elStr, appState: stateStr });
      void queryClient.invalidateQueries({ queryKey: orpc.whiteboard.get.queryOptions({ input: { id: boardId } }).queryKey });
      void queryClient.invalidateQueries({ queryKey: orpc.whiteboard.list.queryOptions({}).queryKey });
    },
    [boardId, queryClient]
  );

  const saveDebouncer = useAsyncDebouncer(
    saveFn,
    {
      wait: 1500,
      onUnmount: (d) => d.flush(),
      asyncRetryerOptions: {
        maxAttempts: 3,
        backoff: 'exponential',
        baseWait: 1000,
        maxWait: 10000,
        jitter: 0.3
      }

    },
  );

  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const pendingNavigationRef = useRef<string | null>(null);
  const router = useRouter();

  // Flush pending saves when the page becomes hidden (tab close, tab switch, browser close).
  // visibilitychange is more reliable than beforeunload — the browser allows network
  // requests with keepalive:true to complete even after the page is discarded.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveDebouncer.flush();
      }
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveDebouncer.store.state.isPending) {
        e.preventDefault();
        saveDebouncer.flush();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveDebouncer]);

  const handleNavigation = useCallback(
    (href: string) => {
      if (saveDebouncer.store.state.isPending || wasEditingTextRef.current) {
        pendingNavigationRef.current = href;
        setShowLeaveDialog(true);
      } else {
        router.push(href);
      }
    },
    [saveDebouncer, router]
  );

  const handleLeaveConfirm = useCallback(() => {
    saveDebouncer.flush();
    setShowLeaveDialog(false);
    if (pendingNavigationRef.current) {
      router.push(pendingNavigationRef.current);
      pendingNavigationRef.current = null;
    }
  }, [saveDebouncer, router]);

  const handleLeaveCancel = useCallback(() => {
    setShowLeaveDialog(false);
    pendingNavigationRef.current = null;
  }, []);

  const handleChange = useCallback(
    (newElements: readonly ExcalidrawElement[], newAppState: AppState) => {
      if (!useWhiteboardStore.getState().initialized) return;
      latestAppStateRef.current = JSON.stringify(newAppState);

      const isEditingText = !!newAppState.editingTextElement;
      const textEditJustEnded = wasEditingTextRef.current && !isEditingText;
      wasEditingTextRef.current = isEditingText;

      // Always track element changes even during text editing
      const elementsChanged = hasElementsChanged(newElements);

      // Don't save while text is being edited — elements have stale text content.
      // Save will fire when editing ends (textEditJustEnded) with committed text.
      if (isEditingText) return;

      if (!elementsChanged && !textEditJustEnded) return;

      const elStr = JSON.stringify(newElements);
      latestElementsRef.current = elStr;
      const currentName = useWhiteboardStore.getState().name;
      saveDebouncer.maybeExecute(currentName, elStr, latestAppStateRef.current);
    },
    [saveDebouncer, hasElementsChanged]
  );

  const handleUpdateName = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setName(newName);
      saveDebouncer.maybeExecute(newName, latestElementsRef.current, latestAppStateRef.current);
    },
    [setName, saveDebouncer]
  );

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!board) return <div className="text-center text-muted-foreground mt-20">Board not found.</div>;

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto min-h-screen">
      <div className="flex items-center justify-between sticky top-0 z-20 py-4 mb-4 bg-background/50 backdrop-blur-xl border-b border-white/5 -mx-4 px-4 sm:mx-0 sm:px-0 sm:bg-transparent sm:backdrop-blur-none sm:border-none">
        <div className="flex items-center gap-4">
          <button
            onClick={() => handleNavigation("/whiteboard")}
            className="flex items-center justify-center p-2 rounded-xl text-muted-foreground hover:bg-glass-border hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={name}
            onChange={handleUpdateName}
            placeholder="Canvas Name"
            className="text-2xl font-manrope font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/30 px-0 focus:ring-0 max-w-[200px] sm:max-w-xs"
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-glass-bg border border-glass-border backdrop-blur-md text-xs font-medium text-muted-foreground">
          <saveDebouncer.Subscribe selector={(state) => ({ isSaving: state.isPending || state.isExecuting })}>
            {({ isSaving: saving }) => saving ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</>
            ) : (
              <><Save className="w-3 h-3" /> Saved</>
            )}
          </saveDebouncer.Subscribe>
        </div>
      </div>

      {elements !== null && (
        <>
          {isFullscreen && (
            <div
              className="fixed inset-0 z-40 bg-background/80 backdrop-blur-2xl"
              onClick={toggleFullscreen}
            />
          )}

          <div className={
            isFullscreen
              ? "fixed inset-4 sm:inset-6 z-50 rounded-3xl overflow-hidden shadow-[0_20px_60px_rgba(124,185,232,0.08)]"
              : ""
          }>
            <WhiteboardEditor
              initialElements={elements}
              initialAppState={appState as AppState}
              onChange={handleChange}
            />
          </div>
        </>
      )}

      {showLeaveDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-2xl" onClick={handleLeaveCancel} />
          <div className="relative w-full max-w-sm rounded-3xl bg-glass-bg/80 backdrop-blur-3xl shadow-[0_20px_60px_rgba(124,185,232,0.08)] p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-destructive/10">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <h3 className="text-lg font-manrope font-bold text-foreground">Unsaved changes</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your canvas has changes that haven&apos;t been saved yet. Leaving now will save and close.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={handleLeaveCancel}
                className="px-5 py-2.5 rounded-full text-sm font-medium text-muted-foreground bg-glass-bg/60 backdrop-blur-md hover:bg-glass-border transition-colors"
              >
                Stay
              </button>
              <button
                onClick={handleLeaveConfirm}
                className="px-5 py-2.5 rounded-full text-sm font-medium text-foreground bg-gradient-to-r from-primary to-secondary hover:opacity-90 transition-opacity"
              >
                Save &amp; leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
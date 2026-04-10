"use client";

import { use, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAsyncDebouncer } from "@tanstack/react-pacer";
import { useSearchParams } from "next/navigation";
import { orpc } from "~/orpc/react";
import { useWhiteboardStore } from "~/stores/whiteboard";
import { WhiteboardEditor } from "~/components/editor/whiteboard";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

export default function EmbedWhiteboardPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const boardId = params.id;
  const searchParams = useSearchParams();
  const locked = searchParams.get("locked") !== null;

  const queryClient = useQueryClient();
  const { data: board, isLoading } = useQuery(orpc.whiteboard.get.queryOptions({ input: { id: boardId } }));
  const { mutateAsync: updateBoard } = useMutation(orpc.whiteboard.update.mutationOptions());
  const updateBoardRef = useRef(updateBoard);
  useEffect(() => { updateBoardRef.current = updateBoard; }, [updateBoard]);

  const { elements, appState } = useWhiteboardStore();
  const initialize = useWhiteboardStore((s) => s.initialize);
  const hasElementsChanged = useWhiteboardStore((s) => s.hasElementsChanged);
  const reset = useWhiteboardStore((s) => s.reset);

  const latestElementsRef = useRef<string>("[]");
  const latestAppStateRef = useRef<string>("{}");
  const wasEditingTextRef = useRef(false);

  useEffect(() => {
    if (board) {
      initialize(board);
      latestElementsRef.current = board.elements ?? "[]";
      latestAppStateRef.current = board.appState ?? "{}";
    }
  }, [board, initialize]);

  useEffect(() => () => reset(), [reset]);

  // --- Save logic (skipped in locked/view-only mode) ---

  const saveFn = useCallback(
    async (elStr: string, stateStr: string) => {
      const currentName = useWhiteboardStore.getState().name;
      await updateBoardRef.current({ id: boardId, name: currentName, elements: elStr, appState: stateStr });
      void queryClient.invalidateQueries({ queryKey: orpc.whiteboard.get.queryOptions({ input: { id: boardId } }).queryKey });
    },
    [boardId, queryClient]
  );

  const saveDebouncer = useAsyncDebouncer(saveFn, {
    wait: 1500,
    onUnmount: (d) => d.flush(),
    asyncRetryerOptions: { maxAttempts: 3, backoff: "exponential", baseWait: 1000, maxWait: 10000, jitter: 0.3 },
  });

  useEffect(() => {
    if (locked) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveDebouncer.flush();
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
  }, [saveDebouncer, locked]);

  const handleChange = useCallback(
    (newElements: readonly ExcalidrawElement[], newAppState: AppState) => {
      if (locked) return;
      if (!useWhiteboardStore.getState().initialized) return;
      latestAppStateRef.current = JSON.stringify(newAppState);

      const isEditingText = !!newAppState.editingTextElement;
      const textEditJustEnded = wasEditingTextRef.current && !isEditingText;
      wasEditingTextRef.current = isEditingText;

      const elementsChanged = hasElementsChanged(newElements);
      if (isEditingText) return;
      if (!elementsChanged && !textEditJustEnded) return;

      const elStr = JSON.stringify(newElements);
      latestElementsRef.current = elStr;
      saveDebouncer.maybeExecute(elStr, latestAppStateRef.current);
    },
    [saveDebouncer, hasElementsChanged, locked]
  );

  if (isLoading) {
    return <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  }

  if (!board) {
    return <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>Board not found</div>;
  }

  return (
    <div style={{ width: "100%", height: "100vh", overflow: "hidden", background: "transparent" }}>
      {elements !== null && (
        <WhiteboardEditor
          initialElements={elements}
          initialAppState={appState as AppState}
          onChange={handleChange}
          viewMode={locked}
        />
      )}
    </div>
  );
}

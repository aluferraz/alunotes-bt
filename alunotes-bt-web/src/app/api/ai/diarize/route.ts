import { type NextRequest } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { env } from "~/env";
import { db } from "~/server/db";
import { resolveWavPath } from "~/server/api/routers/notes";

export const maxDuration = 600; // 10 min for model loading + inference on Pi

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { noteId: string };
  if (!body.noteId) {
    return Response.json({ error: "noteId is required" }, { status: 400 });
  }

  const note = await db.note.findUnique({
    where: { id: body.noteId },
  });
  if (!note?.recordingSessionId) {
    return Response.json({ error: "Note has no linked recording" }, { status: 404 });
  }

  const wavPath = resolveWavPath(note.recordingSessionId);
  if (!wavPath) {
    return Response.json({ error: "Recording WAV file not found" }, { status: 404 });
  }

  // Build multipart form for AI server
  const fileBuffer = fs.readFileSync(wavPath);
  const blob = new Blob([fileBuffer], { type: "audio/wav" });
  const form = new FormData();
  form.append("audio", blob, path.basename(wavPath));

  // Call AI diarize endpoint (SSE)
  const aiRes = await fetch(`${env.AI_API_URL}/v1/asr/diarize`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });

  if (!aiRes.ok) {
    const text = await aiRes.text();
    return Response.json({ error: `AI server error (${aiRes.status}): ${text}` }, { status: 502 });
  }

  // Stream SSE from AI server through to browser
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = aiRes.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "No response body" })}\n\n`));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines and forward them
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              controller.enqueue(encoder.encode(line + "\n\n"));
            } else if (line.startsWith("event:")) {
              controller.enqueue(encoder.encode(line + "\n"));
            } else if (line.trim() === "") {
              // Empty line = end of SSE event, skip (already handled by \n\n above)
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          controller.enqueue(encoder.encode(buffer + "\n\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

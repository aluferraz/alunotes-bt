import { type NextRequest } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { env } from "~/env";

export const maxDuration = 600; // LLM generation can take a while on RPi (cold start + inference)

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { prompt: string };
  const transcript = body.prompt;

  if (!transcript) {
    return Response.json({ error: "prompt (transcript) is required" }, { status: 400 });
  }

  const openai = createOpenAI({
    baseURL: `${env.AI_API_URL}/v1`,
    apiKey: "local",
  });

  try {
    const result = streamText({
      model: openai(env.AI_MODEL),
      system: `You are a note-taking assistant. Given a diarized audio transcript, create well-structured notes in markdown format.

Rules:
- Extract key topics, decisions, action items, and important points
- Use headings, bullet points, and bold text for structure
- Keep it concise but comprehensive
- If there are multiple speakers, note who said what when relevant
- Don't include timestamps in the notes (the transcript has them for reference)
- Write in the same language as the transcript`,
      prompt: `Create structured notes from this audio transcript:\n\n${transcript}`,
      // streamText returns a stream before the upstream fetch happens, so the outer try/catch
      // cannot see mid-stream failures (e.g. upstream 404). onError is the only server-side hook.
      onError: ({ error }) => {
        console.error("[generate-note] stream error:", error);
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    console.error("[generate-note] streamText error:", err);
    const message = err instanceof Error ? err.message : "LLM generation failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

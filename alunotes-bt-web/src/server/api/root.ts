import { bluetoothRouter } from "~/server/api/routers/bluetooth";
import { recordingsRouter } from "~/server/api/routers/recordings";
import { settingsRouter } from "~/server/api/routers/settings";
import { profileRouter } from "~/server/api/routers/profile";
import { notesRouter } from "~/server/api/routers/notes";
import { tasksRouter } from "~/server/api/routers/tasks";
import { whiteboardRouter } from "~/server/api/routers/whiteboard";

export const appRouter = {
  bluetooth: bluetoothRouter,
  recordings: recordingsRouter,
  settings: settingsRouter,
  profile: profileRouter,
  notes: notesRouter,
  tasks: tasksRouter,
  whiteboard: whiteboardRouter,
};

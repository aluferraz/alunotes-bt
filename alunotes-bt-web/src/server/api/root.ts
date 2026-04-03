import { bluetoothRouter } from "~/server/api/routers/bluetooth";
import { recordingsRouter } from "~/server/api/routers/recordings";
import { settingsRouter } from "~/server/api/routers/settings";
import { profileRouter } from "~/server/api/routers/profile";

export const appRouter = {
  bluetooth: bluetoothRouter,
  recordings: recordingsRouter,
  settings: settingsRouter,
  profile: profileRouter,
};

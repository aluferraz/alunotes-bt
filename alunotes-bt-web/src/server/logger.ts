import pino from "pino";
import pinoPretty from "pino-pretty";

const isDev = process.env.NODE_ENV === "development";

export const logger = isDev
  ? pino({ level: "debug" }, pinoPretty({ colorize: true }))
  : pino({ level: "warn" });

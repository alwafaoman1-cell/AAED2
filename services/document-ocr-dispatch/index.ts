import { waitUntil } from "@vercel/functions";
import { Hono } from "hono";
import { createDispatchHandler } from "./handler.ts";

const dispatch = createDispatchHandler({
  env: () => ({
    OCR_INTERNAL_URL: process.env.OCR_INTERNAL_URL,
    TEMO_OCR_DISPATCH_SECRET: process.env.TEMO_OCR_DISPATCH_SECRET,
    TEMO_DOCUMENT_DOWNLOAD_SECRET: process.env.TEMO_DOCUMENT_DOWNLOAD_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
  }),
  fetcher: fetch,
  schedule: waitUntil,
  log: (event) => console.warn(JSON.stringify(event)),
});

const app = new Hono();
app.all("*", (context) => dispatch(context.req.raw));

export default app;

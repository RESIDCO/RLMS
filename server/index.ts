import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { invalidateDashboardCache, registerRoutes } from "./routes";
import { purgeExpiredPreviews } from "./commitment";
import { serveStatic } from "./static";
import { createServer, type IncomingMessage } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// CORS — allow the Perplexity-hosted frontend and any custom domain to call this API
app.use(
  cors({
    origin: [
      // Perplexity Computer static hosting
      /\.pplx\.app$/,
      /perplexity\.ai$/,
      // Local dev
      "http://localhost:5000",
      "http://127.0.0.1:5000",
      // Any custom domain set via env (e.g. https://app.residco.com)
      ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
    ],
    credentials: true,
  })
);

function attachRawBody(req: IncomingMessage, _res: unknown, buf: Buffer) {
  req.rawBody = buf;
}

// Bulk Import posts parsed workbooks as JSON (financial sheet matrices,
// acquisitions, master car list). Default Express 100kb 413s those.
// VCF should be multipart (the xlsx/csv file); 60mb is the JSON safety net
// if a client still posts rows. Render's Node web service does not document
// a smaller request-body cap than this.
app.use(
  "/api/import",
  express.json({
    limit: "60mb",
    verify: attachRawBody,
  }),
);
app.use(
  express.json({
    verify: attachRawBody,
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      if (req.method !== "GET" && res.statusCode >= 200 && res.statusCode < 300) {
        invalidateDashboardCache();
      }
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const multerTooBig = err?.code === "LIMIT_FILE_SIZE";
    const status = multerTooBig ? 413 : err.status || err.statusCode || 500;
    const tooLarge = status === 413 || err?.type === "entity.too.large" || multerTooBig;
    const message = tooLarge
      ? "This upload is too large. Drop the Excel/CSV file so the server can parse it (Valid Car File: 50 MB file, 60 MB JSON). HTTP 413."
      : err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const listenOpts: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  // reusePort is unsupported on Windows and throws at listen()
  if (process.platform !== "win32") {
    listenOpts.reusePort = true;
  }
  httpServer.listen(listenOpts, () => {
    log(`serving on port ${port}`);
    purgeExpiredPreviews().catch((e) => console.warn("[preview] startup purge skipped:", e?.message ?? e));
  });
})();

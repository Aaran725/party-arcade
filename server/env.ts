// Loads .env into process.env for whichever entry point imports this module — the real
// server (server/index.ts) and the plain-HTTP preview scripts both need it, and importing
// it here (rather than only from index.ts) means it works regardless of which one runs.
try {
  process.loadEnvFile();
} catch {
  // No .env file present — fine, GROQ_API_KEY* just won't be set and rateDrawing.ts
  // falls back to the local heuristic for every submission.
}

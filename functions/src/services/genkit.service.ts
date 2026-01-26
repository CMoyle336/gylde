/**
 * Genkit Service
 *
 * Centralized configuration for server-side generative AI (Gemini via Google AI).
 * We keep initialization lazy so only functions that bind the secret will use it.
 */
import {genkit} from "genkit";
import {googleAI} from "@genkit-ai/google-genai";

let cachedAi: ReturnType<typeof genkit> | null = null;

export function getAi() {
  if (cachedAi) return cachedAi;

  cachedAi = genkit({
    // Important: this codebase exports many functions from one bundle.
    // We must NOT require `GEMINI_API_KEY` to exist at module load time,
    // because non-AI functions may run in an environment without that secret.
    //
    // Setting `apiKey: false` defers the API key requirement to call-time,
    // where AI functions can pass it via `config.apiKey`.
    plugins: [googleAI({apiKey: false})],
    // Default model for calls that don't override model explicitly.
    model: googleAI.model("gemini-2.5-flash-lite"),
  });

  return cachedAi;
}


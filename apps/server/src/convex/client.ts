import { ConvexHttpClient } from "convex/browser";

let client: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;

  if (!client) {
    client = new ConvexHttpClient(url);
  }
  return client;
}

/**
 * Persist a final transcript entry to Convex.
 * Fails silently if Convex is not configured.
 */
export async function persistTranscript(args: {
  sessionId: string;
  participantId: string;
  speakerName: string;
  originalText: string;
  originalLanguage: string;
  translations?: Record<string, string>;
}): Promise<void> {
  const cvx = getConvexClient();
  if (!cvx) return;

  try {
    // Dynamic import to avoid build-time dependency on generated types.
    // In production, the web app's convex/ folder generates the API types.
    // The server uses raw function references instead.
    await cvx.mutation("transcripts:add" as any, {
      sessionId: args.sessionId,
      participantId: args.participantId,
      speakerName: args.speakerName,
      originalText: args.originalText,
      originalLanguage: args.originalLanguage,
      translations: args.translations,
    });
  } catch (err) {
    console.warn("[convex] Failed to persist transcript:", err);
  }
}

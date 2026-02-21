import { SessionManager } from "./session/manager";
import { handleWebSocket } from "./ws/handler";
import { cloneVoice } from "./pipeline/voice-clone";

const PORT = Number(process.env.WS_SERVER_PORT) || 8080;
const sessionManager = new SessionManager();

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        uptime: process.uptime(),
      });
    }

    if (url.pathname === "/api/voice-clone" && req.method === "POST") {
      return handleVoiceClone(req);
    }

    if (
      server.upgrade(req, {
        data: { connectedAt: Date.now() },
      })
    ) {
      return undefined;
    }

    return new Response("Interpreter WS Server", { status: 200 });
  },
  websocket: handleWebSocket(sessionManager),
});

console.log(`[interpreter] WebSocket server listening on ws://localhost:${server.port}`);

async function handleVoiceClone(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const result = await cloneVoice(buffer, file.name);

    if (!result) {
      return Response.json({ error: "Voice cloning failed" }, { status: 500 });
    }

    return Response.json({
      voiceId: result.voiceId,
      status: result.status,
    });
  } catch (err) {
    console.error("[api] voice-clone error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("transcripts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .take(500);
  },
});

export const add = mutation({
  args: {
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    speakerName: v.string(),
    originalText: v.string(),
    originalLanguage: v.string(),
    translations: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("transcripts", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("participants")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
  },
});

export const join = mutation({
  args: {
    sessionId: v.id("sessions"),
    userId: v.string(),
    name: v.string(),
    spokenLanguage: v.string(),
    listenLanguage: v.string(),
    voiceCloneConsent: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("participants", {
      ...args,
      joinedAt: Date.now(),
    });
  },
});

export const updateSettings = mutation({
  args: {
    id: v.id("participants"),
    listenLanguage: v.optional(v.string()),
    voiceProfileId: v.optional(v.string()),
    voiceCloneConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...updates }) => {
    const clean = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length > 0) {
      await ctx.db.patch(id, clean);
    }
  },
});

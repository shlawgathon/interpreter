import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("voiceProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const create = mutation({
  args: {
    userId: v.string(),
    voiceId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("voiceProfiles", {
      ...args,
      status: "pending",
      consentedAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("voiceProfiles"),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("expired"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status });
  },
});

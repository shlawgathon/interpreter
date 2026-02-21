import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("sessions").order("desc").take(50);
  },
});

export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    hostId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sessions", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const end = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "ended" });
  },
});

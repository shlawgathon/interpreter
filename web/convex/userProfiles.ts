import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const userId = identity.subject;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("byUserId", (q) => q.eq("userId", userId))
      .unique();

    return profile;
  },
});

export const createOrUpdateProfile = mutation({
  args: {
    displayName: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;

    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("byUserId", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        language: args.language,
      });
      return existing._id;
    }

    return await ctx.db.insert("userProfiles", {
      userId,
      displayName: args.displayName,
      email: identity.email ?? undefined,
      language: args.language,
      voiceProfileStatus: "none",
    });
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const updateVoiceProfile = mutation({
  args: {
    voiceProfileId: v.string(),
    voiceAudioStorageId: v.optional(v.id("_storage")),
    voiceProfileStatus: v.union(
      v.literal("none"),
      v.literal("recording"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("byUserId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found. Create a profile first.");

    const patch: Record<string, unknown> = {
      voiceProfileId: args.voiceProfileId,
      voiceProfileStatus: args.voiceProfileStatus,
      voiceProfileCreatedAt: Date.now(),
    };
    if (args.voiceAudioStorageId) {
      patch.voiceAudioStorageId = args.voiceAudioStorageId;
    }

    await ctx.db.patch(profile._id, patch);
  },
});

export const setVoiceStatus = mutation({
  args: {
    status: v.union(
      v.literal("none"),
      v.literal("recording"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("byUserId", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) throw new Error("Profile not found");

    await ctx.db.patch(profile._id, { voiceProfileStatus: args.status });
  },
});

// Internal query for backend HTTP lookup
export const getProfileByExternalId = internalQuery({
  args: { externalUserId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("byUserId", (q) => q.eq("userId", args.externalUserId))
      .unique();

    if (!profile) return null;

    // If there's a voice audio file in storage, generate a URL for it
    let voiceAudioUrl: string | null = null;
    if (profile.voiceAudioStorageId) {
      voiceAudioUrl = await ctx.storage.getUrl(profile.voiceAudioStorageId);
    }

    return {
      voiceProfileId: profile.voiceProfileId ?? null,
      voiceAudioUrl,
      voiceProfileStatus: profile.voiceProfileStatus,
      language: profile.language,
      displayName: profile.displayName,
    };
  },
});

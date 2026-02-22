import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Extended user profile with voice clone data
  userProfiles: defineTable({
    userId: v.string(), // Clerk subject (user ID)
    displayName: v.string(),
    email: v.optional(v.string()),
    language: v.string(),
    voiceProfileId: v.optional(v.string()), // MiniMax file_id for voice clone
    voiceAudioStorageId: v.optional(v.id("_storage")), // Convex file storage ID
    voiceProfileStatus: v.union(
      v.literal("none"),
      v.literal("recording"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    voiceProfileCreatedAt: v.optional(v.number()),
  })
    .index("byUserId", ["userId"]),
});

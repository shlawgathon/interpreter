import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    name: v.string(),
    code: v.string(),
    hostId: v.string(),
    status: v.union(v.literal("active"), v.literal("ended")),
    createdAt: v.number(),
  }).index("by_code", ["code"]),

  participants: defineTable({
    sessionId: v.id("sessions"),
    userId: v.string(),
    name: v.string(),
    spokenLanguage: v.string(),
    listenLanguage: v.string(),
    voiceProfileId: v.optional(v.string()),
    voiceCloneConsent: v.boolean(),
    joinedAt: v.number(),
  }).index("by_session", ["sessionId"]),

  transcripts: defineTable({
    sessionId: v.id("sessions"),
    participantId: v.id("participants"),
    speakerName: v.string(),
    originalText: v.string(),
    originalLanguage: v.string(),
    translations: v.optional(v.any()),
    timestamp: v.number(),
  }).index("by_session", ["sessionId"]),

  voiceProfiles: defineTable({
    userId: v.string(),
    voiceId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("expired"),
    ),
    consentedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_user", ["userId"]),
});

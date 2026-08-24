const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // WhatsApp phone number
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Basic profile
    profile: {
      name: {
        type: String,
        default: null,
      },

      timezone: {
        type: String,
        default: "Asia/Kolkata",
      },
    },

    // Things the user explicitly tells the assistant and that may be useful later.
    importantFacts: [
      {
        type: String,
        trim: true,
      },
    ],

    // User preferences
    preferences: [
      {
        key: {
          type: String,
          required: true,
          trim: true,
        },

        value: {
          type: String,
          required: true,
          trim: true,
        },
      },
    ],

    // User routines habits
    routines: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },

        time: {
          type: String,
          default: null,
        },

        days: [
          {
            type: String,
          },
        ],

        enabled: {
          type: Boolean,
          default: true,
        },
      },
    ],

    // Short-term context for the AI. This is NOT the complete chat history.
    recentContext: [
      {
        role: {
          type: String,
          enum: ["user", "assistant"],
          required: true,
        },

        content: {
          type: String,
          required: true,
        },

        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Metadata
    lastInteractionAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
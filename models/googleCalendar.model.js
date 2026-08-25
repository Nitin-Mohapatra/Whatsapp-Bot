const mongoose = require("mongoose");

const googleCalendarSchema =
  new mongoose.Schema(
    {
      phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },

      googleEmail: {
        type: String,
        default: null,
      },

      accessToken: {
        type: String,
        default: null,
      },

      refreshToken: {
        type: String,
        default: null,
      },

      tokenExpiry: {
        type: Date,
        default: null,
      },

      scope: {
        type: [String],
        default: [],
      },

      connected: {
        type: Boolean,
        default: true,
      },

      connectedAt: {
        type: Date,
        default: Date.now,
      },

      oauthState: {
        type: String,
        default: null,
        select: false,
      },

      oauthStateExpiresAt: {
        type: Date,
        default: null,
        select: false,
      },

      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
    {
      timestamps: true,
    }
  );

module.exports = mongoose.model(
  "GoogleCalendar",
  googleCalendarSchema
);
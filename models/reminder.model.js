const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },

    task: {
      type: String,
      required: true,
      trim: true,
    },

    reminderType: {
      type: String,
      enum: ["one_time", "recurring"],
      required: true,
    },

    scheduledFor: {
      type: Date,
      default: null,
    },

    intervalMinutes: {
      type: Number,
      default: null,
    },

    acknowledged: {
      type: Boolean,
      default: false
    },

    acknowledgedAt: {
      type: Date,
      default: null
    },

    escalationRequired: {
      type: Boolean,
      default: false
    },

    escalationAt: {
      type: Date,
      default: null
    },

    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "sent",
        "cancelled",
        "completed",
      ],
      default: "pending",
    },

    lastSentAt: {
      type: Date,
      default: null,
    },

    nextRunAt: {
      type: Date,
      default: null,
    },

    calendarEventId: {
      type: String,
      default: null,
    },

    calendarEventCreated: {
      type: Boolean,
      default: false,
    },

    calendarEventLink: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Reminder", reminderSchema);
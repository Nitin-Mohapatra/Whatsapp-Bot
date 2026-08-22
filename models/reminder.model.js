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

    status: {
      type: String,
      enum: ["pending", "sent", "cancelled", "completed"],
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Reminder", reminderSchema);
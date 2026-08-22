const Reminder = require("../models/reminder.model");

const createReminder = async (req, res) => {
  try {
    const {
      phoneNumber,
      task,
      reminderType,
      scheduledFor,
      intervalMinutes,
    } = req.body;

    // Basic validation
    if (!phoneNumber || !task || !reminderType) {
      return res.status(400).json({
        success: false,
        message: "phoneNumber, task and reminderType are required",
      });
    }

    // Validate reminder type
    if (!["one_time", "recurring"].includes(reminderType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reminderType",
      });
    }

    // One-time reminder needs a scheduled time
    if (reminderType === "one_time" && !scheduledFor) {
      return res.status(400).json({
        success: false,
        message: "scheduledFor is required for one-time reminders",
      });
    }

    // Recurring reminder needs interval
    if (reminderType === "recurring" && !intervalMinutes) {
      return res.status(400).json({
        success: false,
        message: "intervalMinutes is required for recurring reminders",
      });
    }

    const reminder = await Reminder.create({
      phoneNumber,
      task,
      reminderType,
      scheduledFor: scheduledFor || null,
      intervalMinutes: intervalMinutes || null,
      status: "pending",
      nextRunAt:
        reminderType === "one_time"
          ? scheduledFor
          : new Date(Date.now() + intervalMinutes * 60 * 1000),
    });

    return res.status(201).json({
      success: true,
      message: "Reminder created successfully",
      data: reminder,
    });
  } catch (error) {
    console.error("Create reminder error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create reminder",
      error: error.message,
    });
  }
};

module.exports = {
  createReminder,
};
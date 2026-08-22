const Reminder = require("../models/reminder.model");

// Import your existing AI service
const { parseReminder } = require("./ai.service");

// Import your existing time parser
const { parseReminderTime } = require("./time.service");

const processReminderMessage = async ({ phoneNumber, message }) => {
  try {
    console.log("Processing reminder message:", message);

    // --------------------------------
    // STEP 1 — AI
    // --------------------------------

    const aiResult = await parseReminder(message);

    console.log("AI result:", aiResult);

    if (!aiResult || aiResult.intent !== "create_reminder") {
      return {
        isReminder: false,
      };
    }

    // --------------------------------
    // STEP 2 — TIME PARSER
    // --------------------------------

    const timeResult = parseReminderTime(
      aiResult.timeText,
      aiResult.recurring
    );

    console.log("Time parser result:", timeResult);

    if (!timeResult || !timeResult.scheduledFor && !timeResult.intervalMinutes) {
      throw new Error("Unable to determine reminder time");
    }

    // --------------------------------
    // STEP 3 — SAVE TO DATABASE
    // --------------------------------

    const reminderType = timeResult.reminderType;

    const reminder = await Reminder.create({
      phoneNumber,
      task: aiResult.task,
      reminderType,

      scheduledFor:
        reminderType === "one_time"
          ? timeResult.scheduledFor
          : null,

      intervalMinutes:
        reminderType === "recurring"
          ? timeResult.intervalMinutes
          : null,

      status: "pending",

      nextRunAt:
        reminderType === "one_time"
          ? timeResult.scheduledFor
          : new Date(
              Date.now() + timeResult.intervalMinutes * 60 * 1000
            ),
    });

    console.log("Reminder saved:", reminder._id);

    return {
      isReminder: true,
      reminder,
    };
  } catch (error) {
    console.error("Reminder pipeline error:", error);
    throw error;
  }
};

module.exports = {
  processReminderMessage,
};
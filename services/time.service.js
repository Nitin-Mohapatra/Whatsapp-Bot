const chrono = require("chrono-node");
const { DateTime } = require("luxon");

/**
 * Convert natural language reminder time into
 * a scheduler-friendly format.
 *
 * Examples:
 * "every 2 hours"
 * "tomorrow at 8 PM"
 * "in 30 minutes"
 * "Monday at 10 AM"
 * "at 6 PM"
 */

const parseReminderTime = (timeText, recurring = false) => {
  if (!timeText) {
    throw new Error("Reminder time is required");
  }

  const normalized = timeText.trim().toLowerCase();

  // -----------------------------------------
  // RECURRING REMINDERS
  // -----------------------------------------

  if (recurring) {
    // every X minutes
    let match = normalized.match(
      /every\s+(\d+)\s*(minute|minutes|min|mins)/
    );

    if (match) {
      return {
        reminderType: "recurring",
        intervalMinutes: Number(match[1]),
      };
    }

    // every X hours
    match = normalized.match(
      /every\s+(\d+)\s*(hour|hours|hr|hrs)/
    );

    if (match) {
      return {
        reminderType: "recurring",
        intervalMinutes: Number(match[1]) * 60,
      };
    }

    // every X days
    match = normalized.match(
      /every\s+(\d+)\s*(day|days)/
    );

    if (match) {
      return {
        reminderType: "recurring",
        intervalMinutes: Number(match[1]) * 24 * 60,
      };
    }

    throw new Error(
      `Could not understand recurring time: ${timeText}`
    );
  }

  // -----------------------------------------
  // ONE-TIME REMINDERS
  // -----------------------------------------

  const now = new Date();

  const parsed = chrono.parseDate(timeText, now, {
    forwardDate: true,
  });

  if (!parsed) {
    throw new Error(
      `Could not understand reminder time: ${timeText}`
    );
  }

  return {
    reminderType: "one_time",
    scheduledFor: parsed.toISOString(),
  };
};

module.exports = {
  parseReminderTime,
};
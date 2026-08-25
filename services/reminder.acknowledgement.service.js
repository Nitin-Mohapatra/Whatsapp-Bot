const Reminder = require("../models/reminder.model");

// ============================================================
// NORMALIZE TASK
// ============================================================

const normalizeTask = (task) => {
  if (!task) {
    return "";
  }

  return task
    .toString()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// ============================================================
// TASK MATCHING
// ============================================================

const tasksMatch = (
  reminderTask,
  requestedTask
) => {
  const reminder =
    normalizeTask(
      reminderTask
    );

  const requested =
    normalizeTask(
      requestedTask
    );

  if (
    !reminder ||
    !requested
  ) {
    return false;
  }

  // Exact match
  if (
    reminder === requested
  ) {
    return true;
  }

  // One contains the other
  if (
    reminder.includes(requested) ||
    requested.includes(reminder)
  ) {
    return true;
  }

  // Compare words
  const reminderWords =
    new Set(
      reminder.split(" ")
    );

  const requestedWords =
    new Set(
      requested.split(" ")
    );

  let commonWords = 0;

  for (
    const word of requestedWords
  ) {
    if (
      word.length > 2 &&
      reminderWords.has(word)
    ) {
      commonWords++;
    }
  }

  if (
    requestedWords.size > 0 &&
    commonWords >=
      Math.max(
        1,
        Math.ceil(
          requestedWords.size * 0.5
        )
      )
  ) {
    return true;
  }

  return false;
};

// ============================================================
// ACKNOWLEDGE SPECIFIC REMINDER
// ============================================================

const acknowledgeReminderByTask = async (
  phoneNumber,
  task
) => {
  if (!phoneNumber) {
    return {
      acknowledged: false,
      reminder: null,
    };
  }

  // ----------------------------------------------------------
  // If no task was supplied, fall back to latest reminder
  // ----------------------------------------------------------

  if (!task) {
    return acknowledgeLatestReminder(
      phoneNumber
    );
  }

  const reminders =
    await Reminder.find({
      phoneNumber,

      acknowledged: false,

      lastSentAt: {
        $ne: null,
      },

      status: {
        $nin: [
          "cancelled",
          "completed",
        ],
      },
    })
      .sort({
        lastSentAt: -1,
      })
      .limit(20);

  if (
    !reminders.length
  ) {
    return {
      acknowledged: false,
      reminder: null,
    };
  }

  // ----------------------------------------------------------
  // Find semantic/simple task match
  // ----------------------------------------------------------

  const matchingReminder =
    reminders.find(
      (reminder) =>
        tasksMatch(
          reminder.task,
          task
        )
    );

  if (
    !matchingReminder
  ) {
    console.log(
      `ℹ️ No reminder matched task: "${task}"`
    );

    return {
      acknowledged: false,
      reminder: null,
    };
  }

  matchingReminder.acknowledged =
    true;

  matchingReminder.acknowledgedAt =
    new Date();

  if (
    matchingReminder.reminderType ===
    "one_time"
  ) {
    matchingReminder.status =
      "completed";
  }

  await matchingReminder.save();

  console.log(
    `✅ Reminder acknowledged by task match: ${matchingReminder.task}`
  );

  return {
    acknowledged: true,
    reminder:
      matchingReminder,
  };
};

// ============================================================
// ACKNOWLEDGE LATEST REMINDER
// ============================================================

const acknowledgeLatestReminder = async (
  phoneNumber
) => {
  const reminder =
    await Reminder.findOne({
      phoneNumber,

      acknowledged: false,

      lastSentAt: {
        $ne: null,
      },

      status: {
        $nin: [
          "cancelled",
          "completed",
        ],
      },
    })
      .sort({
        lastSentAt: -1,
      });

  if (!reminder) {
    return {
      acknowledged: false,
      reminder: null,
    };
  }

  reminder.acknowledged =
    true;

  reminder.acknowledgedAt =
    new Date();

  if (
    reminder.reminderType ===
    "one_time"
  ) {
    reminder.status =
      "completed";
  }

  await reminder.save();

  console.log(
    `✅ Latest reminder acknowledged by ${phoneNumber}: ${reminder.task}`
  );

  return {
    acknowledged: true,
    reminder,
  };
};

// ============================================================
// GET PENDING/SENT REMINDERS
// ============================================================

const getPendingAcknowledgmentReminders =
  async (
    phoneNumber
  ) => {
    if (!phoneNumber) {
      return [];
    }

    const reminders =
      await Reminder.find({
        phoneNumber,

        acknowledged: false,

        lastSentAt: {
          $ne: null,
        },

        status: {
          $nin: [
            "cancelled",
            "completed",
          ],
        },
      })
        .sort({
          lastSentAt: -1,
        })
        .limit(20)
        .lean();

    return reminders;
  };

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  acknowledgeReminderByTask,
  acknowledgeLatestReminder,
  getPendingAcknowledgmentReminders,
};
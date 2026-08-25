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
// TASK MATCH SCORE
// ============================================================

const getTaskMatchScore = (
  reminderTask,
  requestedTask
) => {
  const reminder =
    normalizeTask(reminderTask);

  const requested =
    normalizeTask(requestedTask);

  if (
    !reminder ||
    !requested
  ) {
    return 0;
  }

  // ----------------------------------------------------------
  // Exact match
  // ----------------------------------------------------------

  if (
    reminder === requested
  ) {
    return 100;
  }

  // ----------------------------------------------------------
  // One contains the other
  // ----------------------------------------------------------

  if (
    reminder.includes(requested) ||
    requested.includes(reminder)
  ) {
    return 90;
  }

  // ----------------------------------------------------------
  // Word matching
  // ----------------------------------------------------------

  const reminderWords =
    new Set(
      reminder.split(" ")
    );

  const requestedWords =
    new Set(
      requested.split(" ")
    );

  const meaningfulRequestedWords =
    [...requestedWords].filter(
      (word) =>
        word.length > 2
    );

  if (
    meaningfulRequestedWords.length === 0
  ) {
    return 0;
  }

  let matchedWords = 0;

  for (
    const word of meaningfulRequestedWords
  ) {
    if (
      reminderWords.has(word)
    ) {
      matchedWords++;
    }
  }

  const percentage =
    matchedWords /
    meaningfulRequestedWords.length;

  if (percentage === 1) {
    return 85;
  }

  if (percentage >= 0.75) {
    return 70;
  }

  if (percentage >= 0.5) {
    return 50;
  }

  return 0;
};

// ============================================================
// GET ACTIVE REMINDERS
// ============================================================

const getActiveReminders = async (
  phoneNumber
) => {
  if (!phoneNumber) {
    return [];
  }

  const reminders =
    await Reminder.find({
      phoneNumber,

      status: "pending",

      $or: [
        {
          acknowledged: false,
        },
        {
          acknowledged: {
            $exists: false,
          },
        },
      ],
    })
      .sort({
        nextRunAt: 1,
        createdAt: -1,
      })
      .lean();

  return reminders;
};

// ============================================================
// CANCEL REMINDER BY TASK
// ============================================================

const cancelReminderByTask = async (
  phoneNumber,
  requestedTask
) => {
  try {
    if (!phoneNumber) {
      return {
        cancelled: false,
        reason: "missing_phone_number",
        reminder: null,
        matches: [],
      };
    }

    if (
      !requestedTask ||
      !requestedTask.trim()
    ) {
      return {
        cancelled: false,
        reason: "missing_task",
        reminder: null,
        matches: [],
      };
    }

    console.log(
      `🗑️ Looking for reminder to cancel: "${requestedTask}"`
    );

    // --------------------------------------------------------
    // Get user's active reminders
    // --------------------------------------------------------

    const reminders =
      await getActiveReminders(
        phoneNumber
      );

    console.log(
      `📋 Active reminders found: ${reminders.length}`
    );

    if (
      reminders.length === 0
    ) {
      return {
        cancelled: false,
        reason: "no_active_reminders",
        reminder: null,
        matches: [],
      };
    }

    // --------------------------------------------------------
    // Score every reminder
    // --------------------------------------------------------

    const scoredReminders =
      reminders
        .map((reminder) => ({
          reminder,

          score:
            getTaskMatchScore(
              reminder.task,
              requestedTask
            ),
        }))
        .filter(
          (item) =>
            item.score > 0
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    console.log(
      "🔎 Cancellation matches:",
      scoredReminders.map(
        (item) => ({
          task:
            item.reminder.task,

          score:
            item.score,

          id:
            item.reminder._id,
        })
      )
    );

    // --------------------------------------------------------
    // No match
    // --------------------------------------------------------

    if (
      scoredReminders.length === 0
    ) {
      return {
        cancelled: false,
        reason: "no_matching_reminder",
        reminder: null,
        matches: [],
      };
    }

    const bestMatch =
      scoredReminders[0];

    const secondMatch =
      scoredReminders[1];

    // --------------------------------------------------------
    // Ambiguous match
    //
    // Example:
    //
    // cancel my study reminder
    //
    // Existing:
    // study React
    // study DSA
    //
    // Don't randomly cancel one.
    // --------------------------------------------------------

    if (
      secondMatch &&
      bestMatch.score ===
        secondMatch.score
    ) {
      return {
        cancelled: false,

        reason:
          "ambiguous_match",

        reminder: null,

        matches:
          scoredReminders
            .slice(0, 5)
            .map(
              (item) =>
                item.reminder
            ),
      };
    }

    // --------------------------------------------------------
    // Require reasonable confidence
    // --------------------------------------------------------

    if (
      bestMatch.score < 50
    ) {
      return {
        cancelled: false,

        reason:
          "weak_match",

        reminder: null,

        matches:
          scoredReminders
            .slice(0, 5)
            .map(
              (item) =>
                item.reminder
            ),
      };
    }

    // --------------------------------------------------------
    // Atomically cancel
    //
    // Only cancel if it is still pending.
    // This prevents cancelling a reminder that the scheduler
    // has already claimed and started processing.
    // --------------------------------------------------------

    const cancelledReminder =
      await Reminder.findOneAndUpdate(
        {
          _id:
            bestMatch.reminder._id,

          phoneNumber,

          status:
            "pending",
        },

        {
          $set: {
            status:
              "cancelled",

            nextRunAt:
              null,
          },
        },

        {
          new: true,
        }
      );

    // --------------------------------------------------------
    // Scheduler already picked it up
    // --------------------------------------------------------

    if (
      !cancelledReminder
    ) {
      console.log(
        "⚠️ Reminder could not be cancelled because its status changed."
      );

      return {
        cancelled: false,

        reason:
          "already_processing",

        reminder: null,

        matches: [],
      };
    }

    console.log(
      `✅ Reminder cancelled: ${cancelledReminder._id}`
    );

    console.log(
      `📝 Cancelled task: ${cancelledReminder.task}`
    );

    return {
      cancelled: true,

      reason:
        "cancelled",

      reminder:
        cancelledReminder,

      matches: [],
    };

  } catch (error) {

    console.error(
      "❌ Cancel reminder error:",
      error.message
    );

    throw error;
  }
};

// ============================================================
// CANCEL LATEST REMINDER
// ============================================================
//
// Used for messages such as:
//
// "cancel my latest reminder"
// "cancel the last reminder"
// "cancel it"
//
// We only do this when there is exactly one active reminder.
// If there are multiple, we ask the user to specify the task.
// ============================================================

const cancelLatestReminder = async (
  phoneNumber
) => {
  try {
    if (!phoneNumber) {
      return {
        cancelled: false,
        reason: "missing_phone_number",
        reminder: null,
      };
    }

    const reminders =
      await getActiveReminders(
        phoneNumber
      );

    if (
      reminders.length === 0
    ) {
      return {
        cancelled: false,
        reason: "no_active_reminders",
        reminder: null,
      };
    }

    // --------------------------------------------------------
    // Only one active reminder
    // --------------------------------------------------------

    if (
      reminders.length === 1
    ) {
      const reminder =
        reminders[0];

      const cancelledReminder =
        await Reminder.findOneAndUpdate(
          {
            _id:
              reminder._id,

            phoneNumber,

            status:
              "pending",
          },

          {
            $set: {
              status:
                "cancelled",

              nextRunAt:
                null,
            },
          },

          {
            new: true,
          }
        );

      if (
        !cancelledReminder
      ) {
        return {
          cancelled: false,

          reason:
            "already_processing",

          reminder: null,
        };
      }

      console.log(
        `✅ Latest reminder cancelled: ${cancelledReminder.task}`
      );

      return {
        cancelled: true,

        reason:
          "cancelled",

        reminder:
          cancelledReminder,
      };
    }

    // --------------------------------------------------------
    // Multiple reminders
    // --------------------------------------------------------

    return {
      cancelled: false,

      reason:
        "multiple_reminders",

      reminder: null,

      matches:
        reminders.slice(
          0,
          10
        ),
    };

  } catch (error) {

    console.error(
      "❌ Cancel latest reminder error:",
      error.message
    );

    throw error;
  }
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  cancelReminderByTask,
  cancelLatestReminder,
  getActiveReminders,
};
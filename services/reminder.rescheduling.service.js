const Reminder = require("../models/reminder.model");
const { getActiveReminders } = require("./reminder.cancellation.service");

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const scoreTask = (task, requested) => {
  const left = normalize(task);
  const right = normalize(requested);

  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 90;

  const requestedWords = right.split(" ").filter((word) => word.length > 2);
  const matches = requestedWords.filter((word) => left.split(" ").includes(word));
  return requestedWords.length && matches.length === requestedWords.length ? 85 : 0;
};

const rescheduleReminder = async ({
  phoneNumber,
  requestedTask,
  scheduledFor,
}) => {
  if (!phoneNumber || !requestedTask || !(scheduledFor instanceof Date)) {
    return { rescheduled: false, reason: "invalid_request", reminder: null, matches: [] };
  }

  const reminders = await getActiveReminders(phoneNumber);
  const matches = reminders
    .map((reminder) => ({ reminder, score: scoreTask(reminder.task, requestedTask) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!matches.length) {
    return { rescheduled: false, reason: "no_matching_reminder", reminder: null, matches: [] };
  }

  if (matches[1] && matches[0].score === matches[1].score) {
    return {
      rescheduled: false,
      reason: "ambiguous_match",
      reminder: null,
      matches: matches.slice(0, 5).map((item) => item.reminder),
    };
  }

  const reminder = matches[0].reminder;
  const updated = await Reminder.findOneAndUpdate(
    {
      _id: reminder._id,
      phoneNumber,
      status: "pending",
    },
    {
      $set: {
        scheduledFor,
        nextRunAt: scheduledFor,
        acknowledged: false,
        acknowledgedAt: null,
        lastSentAt: null,
        escalationRequired: false,
        escalationAt: null,
      },
    },
    { new: true }
  );

  if (!updated) {
    return { rescheduled: false, reason: "already_processing", reminder: null, matches: [] };
  }

  return { rescheduled: true, reason: "rescheduled", reminder: updated, matches: [] };
};

module.exports = {
  rescheduleReminder,
};

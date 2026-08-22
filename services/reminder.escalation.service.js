const Reminder = require("../models/reminder.model");

const {
  makeReminderCall,
} = require("./twilio.service");

const checkForNoReplyReminders = async () => {
  try {
    // Prototype:
    // User gets 5 minutes to acknowledge the reminder.
    const NO_REPLY_MINUTES = 5;

    const cutoffTime = new Date(
      Date.now() - NO_REPLY_MINUTES * 60 * 1000
    );

    const reminders = await Reminder.find({
      status: "pending",
      acknowledged: false,

      // Reminder must have already been sent
      lastSentAt: {
        $ne: null,
        $lte: cutoffTime,
      },

      // Don't process the same reminder repeatedly
      escalationRequired: false,
    });

    if (reminders.length === 0) {
      return;
    }

    console.log(
      `⚠️ Found ${reminders.length} reminder(s) with no reply`
    );

    for (const reminder of reminders) {
      try {
        // --------------------------------
        // MARK ESCALATION REQUIRED
        // --------------------------------

        reminder.escalationRequired = true;
        reminder.escalationAt = new Date();

        await reminder.save();

        console.log(
          `🚨 Escalation required for reminder: ${reminder._id}`
        );

        console.log(
          `📞 No reply received for task: ${reminder.task}`
        );

        // --------------------------------
        // TWILIO CALL
        // --------------------------------

        const call = await makeReminderCall({
          phoneNumber: reminder.phoneNumber,
          task: reminder.task,
        });

        console.log(
          `📞 Escalation call initiated: ${call.sid}`
        );

      } catch (error) {
        console.error(
          `❌ Escalation failed for reminder ${reminder._id}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ No-reply detection error:",
      error.message
    );
  }
};

module.exports = {
  checkForNoReplyReminders,
};
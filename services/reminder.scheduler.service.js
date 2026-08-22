const Reminder = require("../models/reminder.model");

const {
  sendWhatsAppMessage,
} = require("./whatsapp.service");

const processDueReminders = async () => {
  try {
    const now = new Date();

    // Find reminders that are due
    const dueReminders = await Reminder.find({
      status: "pending",
      nextRunAt: {
        $lte: now,
      },
    });

    if (dueReminders.length === 0) {
      return;
    }

    console.log(
      `⏰ Found ${dueReminders.length} due reminder(s)`
    );

    for (const reminder of dueReminders) {
      try {
        // --------------------------------
        // ATOMIC CLAIM
        // --------------------------------

        const claimedReminder = await Reminder.findOneAndUpdate(
          {
            _id: reminder._id,
            status: "pending",
            nextRunAt: {
              $lte: new Date(),
            },
          },
          {
            $set: {
              status: "processing",
            },
          },
          {
            new: true,
          }
        );

        // Another scheduler already claimed it
        if (!claimedReminder) {
          console.log(
            `⏭️ Reminder already being processed: ${reminder._id}`
          );

          continue;
        }

        console.log(
          `🔒 Claimed reminder: ${claimedReminder._id}`
        );

        // --------------------------------
        // SEND WHATSAPP MESSAGE
        // --------------------------------

        console.log(
          `📤 Sending reminder to ${claimedReminder.phoneNumber}: ${claimedReminder.task}`
        );

        await sendWhatsAppMessage(
          claimedReminder.phoneNumber,
          `⏰ Reminder: ${claimedReminder.task}`
        );

        // --------------------------------
        // ONE-TIME REMINDER
        // --------------------------------

        if (claimedReminder.reminderType === "one_time") {
          claimedReminder.status = "completed";
          claimedReminder.lastSentAt = new Date();
          claimedReminder.nextRunAt = null;

          await claimedReminder.save();

          console.log(
            `✅ One-time reminder completed: ${claimedReminder._id}`
          );

          continue;
        }

        // --------------------------------
        // RECURRING REMINDER
        // --------------------------------

        if (
          claimedReminder.reminderType === "recurring" &&
          claimedReminder.intervalMinutes
        ) {
          claimedReminder.lastSentAt = new Date();

          claimedReminder.acknowledged = false;
          claimedReminder.acknowledgedAt = null;

          claimedReminder.nextRunAt = new Date(
            Date.now() +
            claimedReminder.intervalMinutes * 60 * 1000
          );

          claimedReminder.status = "pending";

          await claimedReminder.save();

          console.log(
            `🔁 Next reminder scheduled for: ${claimedReminder.nextRunAt}`
          );
        }
      } catch (error) {
        console.error(
          `❌ Failed reminder ${reminder._id}:`,
          error.message
        );

        // --------------------------------
        // RELEASE CLAIM IF SENDING FAILED
        // --------------------------------

        try {
          await Reminder.findByIdAndUpdate(
            reminder._id,
            {
              $set: {
                status: "pending",
              },
            }
          );

          console.log(
            `↩️ Reminder returned to pending: ${reminder._id}`
          );
        } catch (updateError) {
          console.error(
            `❌ Failed to reset reminder ${reminder._id}:`,
            updateError.message
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "Scheduler error:",
      error.message
    );
  }
};

module.exports = {
  processDueReminders,
};
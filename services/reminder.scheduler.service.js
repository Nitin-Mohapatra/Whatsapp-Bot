const Reminder = require("../models/reminder.model");

// We will connect this to your existing WhatsApp sending service
const { sendWhatsAppMessage } = require("./whatsapp.service");

const processDueReminders = async () => {
  try {
    const now = new Date();

    const reminders = await Reminder.find({
      status: "pending",
      nextRunAt: {
        $lte: now,
      },
    });

    if (reminders.length === 0) {
      return;
    }

    console.log(`⏰ Found ${reminders.length} due reminder(s)`);

    for (const reminder of reminders) {
      try {
        console.log(
          `Sending reminder to ${reminder.phoneNumber}: ${reminder.task}`
        );

        // --------------------------------
        // SEND WHATSAPP MESSAGE
        // --------------------------------

        await sendWhatsAppMessage(
          reminder.phoneNumber,
          `⏰ Reminder: ${reminder.task}`
        );

        // --------------------------------
        // ONE-TIME REMINDER
        // --------------------------------

        if (reminder.reminderType === "one_time") {
          reminder.status = "completed";
          reminder.lastSentAt = new Date();
          reminder.nextRunAt = null;

          await reminder.save();

          console.log(
            `✅ One-time reminder completed: ${reminder._id}`
          );

          continue;
        }

        // --------------------------------
        // RECURRING REMINDER
        // --------------------------------

        if (
          reminder.reminderType === "recurring" &&
          reminder.intervalMinutes
        ) {
          reminder.lastSentAt = new Date();

          reminder.nextRunAt = new Date(
            Date.now() + reminder.intervalMinutes * 60 * 1000
          );

          await reminder.save();

          console.log(
            `🔁 Next reminder scheduled for: ${reminder.nextRunAt}`
          );
        }
      } catch (error) {
        console.error(
          `❌ Failed reminder ${reminder._id}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("Scheduler error:", error);
  }
};

module.exports = {
  processDueReminders,
};
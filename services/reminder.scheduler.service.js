const Reminder = require("../models/reminder.model");

const {
  sendWhatsAppMessage,
} = require("./whatsapp.service");


// ============================================================
// PROCESS DUE REMINDERS
// ============================================================

const processDueReminders = async () => {

  try {

    const now =
      new Date();


    console.log(
      `⏰ Scheduler tick: ${now.toISOString()}`
    );


    // ========================================================
    // FIND DUE REMINDERS
    // ========================================================

    const dueReminders =
      await Reminder.find({
        status: "pending",

        nextRunAt: {
          $ne: null,

          $lte: now,
        },
      });


    if (
      dueReminders.length === 0
    ) {

      return;
    }


    console.log(
      `⏰ Found ${dueReminders.length} due reminder(s)`
    );


    // ========================================================
    // PROCESS EACH REMINDER
    // ========================================================

    for (
      const reminder
      of dueReminders
    ) {

      try {

        // ====================================================
        // ATOMIC CLAIM
        // ====================================================

        const claimedReminder =
          await Reminder.findOneAndUpdate(

            {
              _id:
                reminder._id,

              status:
                "pending",

              nextRunAt: {
                $ne: null,

                $lte:
                  new Date(),
              },
            },

            {
              $set: {
                status:
                  "processing",
              },
            },

            {
              new: true,
            }
          );


        if (
          !claimedReminder
        ) {

          console.log(
            `⏭️ Reminder already claimed: ${reminder._id}`
          );

          continue;
        }


        console.log(
          "======================================"
        );

        console.log(
          "🔒 REMINDER CLAIMED"
        );

        console.log(
          "🆔 ID:",
          claimedReminder._id
        );

        console.log(
          "📱 Phone:",
          claimedReminder.phoneNumber
        );

        console.log(
          "📝 Task:",
          claimedReminder.task
        );

        console.log(
          "⏰ Due:",
          claimedReminder.nextRunAt
        );


        // ====================================================
        // SEND WHATSAPP
        // ====================================================

        await sendWhatsAppMessage(

          claimedReminder.phoneNumber,

          `⏰ Reminder: ${claimedReminder.task}`
        );


        console.log(
          "✅ WhatsApp reminder sent"
        );


        // ====================================================
        // ONE-TIME
        // ====================================================

        if (
          claimedReminder.reminderType ===
          "one_time"
        ) {

          claimedReminder.lastSentAt =
            new Date();

          /*
           * Keep pending because the user can
           * acknowledge it.
           */

          claimedReminder.status =
            "pending";


          /*
           * Prevent duplicate sending.
           */

          claimedReminder.nextRunAt =
            null;


          await claimedReminder.save();


          console.log(
            "📨 One-time reminder sent."
          );

          console.log(
            "⏳ Waiting for user acknowledgment."
          );

          console.log(
            "======================================"
          );


          continue;
        }


        // ====================================================
        // RECURRING
        // ====================================================

        if (
          claimedReminder.reminderType ===
            "recurring" &&
          claimedReminder.intervalMinutes
        ) {

          claimedReminder.lastSentAt =
            new Date();


          claimedReminder.nextRunAt =
            new Date(
              Date.now() +
                claimedReminder.intervalMinutes *
                  60 *
                  1000
            );


          claimedReminder.status =
            "pending";


          await claimedReminder.save();


          console.log(
            "🔁 Recurring reminder rescheduled."
          );

          console.log(
            "▶️ Next run:",
            claimedReminder.nextRunAt
          );
        }


        console.log(
          "======================================"
        );


      } catch (error) {

        console.error(
          `❌ Failed reminder ${reminder._id}:`,
          error.message
        );


        // ====================================================
        // RELEASE CLAIM
        // ====================================================

        try {

          await Reminder.findByIdAndUpdate(
            reminder._id,

            {
              $set: {
                status:
                  "pending",
              },
            }
          );


          console.log(
            `↩️ Reminder returned to pending: ${reminder._id}`
          );

        } catch (updateError) {

          console.error(
            "❌ Failed to reset reminder:",
            updateError.message
          );
        }
      }
    }

  } catch (error) {

    console.error(
      "❌ Scheduler error:",
      error.message
    );
  }
};


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  processDueReminders,
};
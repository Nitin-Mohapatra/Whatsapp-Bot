const Reminder = require("../models/reminder.model");

const {
  parseReminder,
} = require("./ai.service");

const {
  parseReminderTime,
} = require("./time.service");


// ============================================================
// CREATE REMINDER FROM STRUCTURED DATA
// ============================================================

const createReminderFromData = async ({
  phoneNumber,
  task,
  timeText,
  recurring = false,
}) => {
  try {
    console.log("======================================");
    console.log("⏰ CREATE REMINDER");
    console.log("======================================");

    console.log("📱 Phone:", phoneNumber);
    console.log("📝 Task:", task);
    console.log("🕐 Time:", timeText);
    console.log("🔁 Recurring:", recurring);


    // ----------------------------------------------------------
    // VALIDATION
    // ----------------------------------------------------------

    if (!phoneNumber) {
      throw new Error(
        "phoneNumber is required"
      );
    }

    if (
      !task ||
      typeof task !== "string" ||
      !task.trim()
    ) {
      throw new Error(
        "Reminder task is required"
      );
    }

    if (
      !timeText ||
      typeof timeText !== "string" ||
      !timeText.trim()
    ) {
      throw new Error(
        "Reminder time is required"
      );
    }


    // ----------------------------------------------------------
    // PARSE TIME
    // ----------------------------------------------------------

    const timeResult =
      parseReminderTime(
        timeText,
        Boolean(recurring)
      );

    console.log(
      "🕐 Parsed time result:",
      timeResult
    );


    if (!timeResult) {
      throw new Error(
        "Unable to determine reminder time"
      );
    }


    // ----------------------------------------------------------
    // VALIDATE PARSED RESULT
    // ----------------------------------------------------------

    if (
      timeResult.reminderType ===
        "one_time" &&
      !timeResult.scheduledFor
    ) {
      throw new Error(
        "One-time reminder has no scheduled time"
      );
    }


    if (
      timeResult.reminderType ===
        "recurring" &&
      !timeResult.intervalMinutes
    ) {
      throw new Error(
        "Recurring reminder has no interval"
      );
    }


    // ----------------------------------------------------------
    // CREATE DATABASE OBJECT
    // ----------------------------------------------------------

    const reminderType =
      timeResult.reminderType;


    const nextRunAt =
      reminderType === "one_time"
        ? new Date(
            timeResult.scheduledFor
          )
        : new Date(
            Date.now() +
              timeResult.intervalMinutes *
                60 *
                1000
          );


    // ----------------------------------------------------------
    // SAFETY CHECK
    // ----------------------------------------------------------

    if (
      Number.isNaN(
        nextRunAt.getTime()
      )
    ) {
      throw new Error(
        "Invalid reminder date"
      );
    }


    // ----------------------------------------------------------
    // SAVE
    // ----------------------------------------------------------

    const reminder =
      await Reminder.create({
        phoneNumber,

        task:
          task.trim(),

        reminderType,

        scheduledFor:
          reminderType === "one_time"
            ? nextRunAt
            : null,

        intervalMinutes:
          reminderType === "recurring"
            ? timeResult.intervalMinutes
            : null,

        acknowledged:
          false,

        acknowledgedAt:
          null,

        escalationRequired:
          false,

        escalationAt:
          null,

        status:
          "pending",

        lastSentAt:
          null,

        nextRunAt,
      });


    console.log(
      "======================================"
    );

    console.log(
      "✅ REMINDER SAVED"
    );

    console.log(
      "🆔 ID:",
      reminder._id
    );

    console.log(
      "📝 Task:",
      reminder.task
    );

    console.log(
      "⏰ Reminder type:",
      reminder.reminderType
    );

    console.log(
      "📅 Scheduled for:",
      reminder.scheduledFor
    );

    console.log(
      "▶️ Next run:",
      reminder.nextRunAt
    );

    console.log(
      "======================================"
    );


    return {
      isReminder: true,

      reminder,
    };

  } catch (error) {

    console.error(
      "❌ createReminderFromData error:",
      error.message
    );

    throw error;
  }
};


// ============================================================
// BACKWARD COMPATIBLE PIPELINE
// ============================================================
//
// This function can still accept a plain message.
//
// BUT:
// If task + timeText are already provided,
// AI IS NOT CALLED AGAIN.
//
// ============================================================

const processReminderMessage = async ({
  phoneNumber,
  message = null,

  task = null,
  timeText = null,
  recurring = false,
}) => {

  try {

    // ========================================================
    // NEW FLOW
    // ========================================================
    //
    // Webhook already extracted task/time.
    //
    // DO NOT CALL AI AGAIN.
    //

    if (
      task &&
      timeText
    ) {

      console.log(
        "⚡ Using structured reminder data. Skipping second AI call."
      );

      return await createReminderFromData({
        phoneNumber,
        task,
        timeText,
        recurring,
      });
    }


    // ========================================================
    // OLD / DIRECT FLOW
    // ========================================================

    if (
      !message ||
      !message.trim()
    ) {

      throw new Error(
        "Either message or task + timeText is required"
      );
    }


    console.log(
      "🤖 No structured reminder data provided."
    );

    console.log(
      "🤖 Running AI parser for direct pipeline call."
    );


    const aiResult =
      await parseReminder(
        message
      );


    console.log(
      "🧠 AI result:",
      aiResult
    );


    if (
      !aiResult ||
      aiResult.intent !==
        "create_reminder"
    ) {

      return {
        isReminder: false,
      };
    }


    // --------------------------------------------------------
    // SUPPORT MULTIPLE REMINDERS
    // --------------------------------------------------------

    const reminders =
      Array.isArray(
        aiResult.reminders
      )
        ? aiResult.reminders
        : [];


    // --------------------------------------------------------
    // BACKWARD COMPATIBILITY
    // --------------------------------------------------------

    if (
      reminders.length === 0 &&
      aiResult.task &&
      aiResult.timeText
    ) {

      reminders.push({
        task:
          aiResult.task,

        timeText:
          aiResult.timeText,

        recurring:
          Boolean(
            aiResult.recurring
          ),
      });
    }


    if (
      reminders.length === 0
    ) {

      return {
        isReminder: false,
        reason:
          "No reminder data extracted",
      };
    }


    // --------------------------------------------------------
    // CREATE ALL
    // --------------------------------------------------------

    const createdReminders = [];

    const failedReminders = [];


    for (
      const reminderData
      of reminders
    ) {

      try {

        const result =
          await createReminderFromData({
            phoneNumber,

            task:
              reminderData.task,

            timeText:
              reminderData.timeText,

            recurring:
              Boolean(
                reminderData.recurring
              ),
          });


        if (
          result?.reminder
        ) {

          createdReminders.push(
            result.reminder
          );
        }

      } catch (error) {

        console.error(
          "❌ Failed to create reminder:",
          reminderData,

          error.message
        );

        failedReminders.push({
          ...reminderData,

          error:
            error.message,
        });
      }
    }


    return {
      isReminder:
        createdReminders.length >
        0,

      reminder:
        createdReminders[0] ||
        null,

      reminders:
        createdReminders,

      failedReminders,
    };


  } catch (error) {

    console.error(
      "❌ Reminder pipeline error:",
      error.message
    );

    throw error;
  }
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  processReminderMessage,
  createReminderFromData,
};
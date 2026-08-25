// src/services/reminder.pipeline.service.js

const Reminder = require("../models/reminder.model");

/*
|--------------------------------------------------------------------------
| Process Reminder Message
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| The AI has ALREADY analyzed the message in webhook.controller.js.
|
| We do NOT call the AI again here.
|
| The controller passes:
|
| {
|   intent,
|   task,
|   date,
|   time,
|   scheduledFor,
|   recurring,
|   recurrence
| }
|
|--------------------------------------------------------------------------
*/

const processReminderMessage = async ({
  phoneNumber,
  message,
  aiResult,
}) => {
  try {
    console.log(
      "📅 Processing reminder:",
      message
    );

    console.log(
      "🧠 AI result received by reminder pipeline:",
      JSON.stringify(
        aiResult,
        null,
        2
      )
    );

    // ==========================================================
    // STEP 1 — VALIDATE AI RESULT
    // ==========================================================

    if (!aiResult) {
      console.log(
        "❌ No AI result received"
      );

      return {
        isReminder: false,
        reason: "missing_ai_result",
      };
    }

    if (
      aiResult.intent !==
      "create_reminder"
    ) {
      console.log(
        "ℹ️ AI intent is not create_reminder:",
        aiResult.intent
      );

      return {
        isReminder: false,
        reason: "not_create_reminder",
      };
    }

    // ==========================================================
    // STEP 2 — VALIDATE TASK
    // ==========================================================

    const task =
      typeof aiResult.task === "string"
        ? aiResult.task.trim()
        : "";

    if (!task) {
      console.log(
        "❌ AI did not provide a task"
      );

      return {
        isReminder: false,
        reason: "missing_task",
      };
    }

    // ==========================================================
    // STEP 3 — DETERMINE REMINDER TYPE
    // ==========================================================

    const isRecurring =
      Boolean(
        aiResult.recurring
      );

    const reminderType =
      isRecurring
        ? "recurring"
        : "one_time";

    // ==========================================================
    // STEP 4 — GET SCHEDULED TIME
    // ==========================================================

    /*
     * For one-time reminders, AI should provide:
     *
     * scheduledFor:
     * 2026-08-25T10:49:00+05:30
     */

    let scheduledFor = null;

    if (
      aiResult.scheduledFor
    ) {
      scheduledFor =
        new Date(
          aiResult.scheduledFor
        );
    }

    // ==========================================================
    // STEP 5 — VALIDATE DATE
    // ==========================================================

    if (
      reminderType === "one_time"
    ) {
      if (
        !scheduledFor ||
        Number.isNaN(
          scheduledFor.getTime()
        )
      ) {
        console.log(
          "❌ Invalid scheduledFor:",
          aiResult.scheduledFor
        );

        return {
          isReminder: false,
          reason: "invalid_scheduled_time",
        };
      }

      // --------------------------------------------------------
      // Do not allow a reminder to be created in the past.
      // --------------------------------------------------------

      if (
        scheduledFor.getTime() <=
        Date.now()
      ) {
        console.log(
          "❌ AI returned a time in the past:",
          scheduledFor
        );

        return {
          isReminder: false,
          reason: "scheduled_time_in_past",
        };
      }
    }

    // ==========================================================
    // STEP 6 — RECURRING REMINDER
    // ==========================================================

    let intervalMinutes = null;

    if (
      reminderType === "recurring"
    ) {
      /*
       * Support the structured format:
       *
       * recurrence:
       * {
       *   intervalMinutes: 120
       * }
       *
       * Also support:
       *
       * intervalMinutes: 120
       */

      if (
        aiResult.intervalMinutes
      ) {
        intervalMinutes =
          Number(
            aiResult.intervalMinutes
          );
      }

      if (
        aiResult.recurrence &&
        typeof aiResult.recurrence ===
          "object" &&
        aiResult.recurrence.intervalMinutes
      ) {
        intervalMinutes =
          Number(
            aiResult.recurrence
              .intervalMinutes
          );
      }

      /*
       * If we don't have an interval,
       * don't create a broken recurring reminder.
       */

      if (
        !intervalMinutes ||
        Number.isNaN(
          intervalMinutes
        ) ||
        intervalMinutes <= 0
      ) {
        console.log(
          "⚠️ Recurring reminder detected but intervalMinutes is missing."
        );

        /*
         * If AI gave a valid scheduledFor,
         * we can still use it as the first run,
         * but we cannot safely create a recurring
         * interval without the interval.
         */

        return {
          isReminder: false,
          reason:
            "missing_recurring_interval",
        };
      }
    }

    // ==========================================================
    // STEP 7 — CALCULATE NEXT RUN
    // ==========================================================

    let nextRunAt = null;

    if (
      reminderType === "one_time"
    ) {
      nextRunAt =
        scheduledFor;
    }

    if (
      reminderType === "recurring"
    ) {
      nextRunAt =
        scheduledFor ||
        new Date(
          Date.now() +
            intervalMinutes *
              60 *
              1000
        );
    }

    // ==========================================================
    // STEP 8 — SAVE TO MONGODB
    // ==========================================================

    const reminder =
      await Reminder.create({
        phoneNumber,

        task,

        reminderType,

        scheduledFor:
          reminderType === "one_time"
            ? scheduledFor
            : null,

        intervalMinutes:
          reminderType === "recurring"
            ? intervalMinutes
            : null,

        status:
          "pending",

        nextRunAt,

        acknowledged:
          false,

        acknowledgedAt:
          null,
      });

    console.log(
      "✅ Reminder saved:",
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
      "⏰ Scheduled for:",
      reminder.scheduledFor
    );

    console.log(
      "🔁 Interval:",
      reminder.intervalMinutes
    );

    console.log(
      "▶️ Next run:",
      reminder.nextRunAt
    );

    // ==========================================================
    // STEP 9 — RETURN RESULT
    // ==========================================================

    return {
      isReminder: true,

      reminder,

      aiResult,
    };

  } catch (error) {

    console.error(
      "❌ Reminder pipeline error:",
      error
    );

    throw error;
  }
};

module.exports = {
  processReminderMessage,
};
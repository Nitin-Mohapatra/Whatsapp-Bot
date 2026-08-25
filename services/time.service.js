const chrono = require("chrono-node");
const { DateTime } = require("luxon");


// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_TIMEZONE =
  process.env.ASSISTANT_TIMEZONE ||
  "Asia/Kolkata";


// ============================================================
// PARSE REMINDER TIME
// ============================================================

const parseReminderTime = (
  timeText,
  recurring = false
) => {

  if (
    !timeText ||
    typeof timeText !== "string"
  ) {
    throw new Error(
      "Reminder time is required"
    );
  }


  const normalized =
    timeText
      .trim()
      .toLowerCase();


  console.log(
    "🕐 Parsing reminder time:",
    timeText
  );


  // ==========================================================
  // RECURRING REMINDERS
  // ==========================================================

  if (recurring) {

    // --------------------------------------------------------
    // EVERY X MINUTES
    // --------------------------------------------------------

    let match =
      normalized.match(
        /every\s+(\d+)\s*(minute|minutes|min|mins)/
      );


    if (match) {

      const intervalMinutes =
        Number(match[1]);


      if (
        intervalMinutes <= 0
      ) {
        throw new Error(
          "Recurring interval must be greater than 0"
        );
      }


      return {
        reminderType:
          "recurring",

        intervalMinutes,
      };
    }


    // --------------------------------------------------------
    // EVERY X HOURS
    // --------------------------------------------------------

    match =
      normalized.match(
        /every\s+(\d+)\s*(hour|hours|hr|hrs)/
      );


    if (match) {

      const intervalMinutes =
        Number(match[1]) * 60;


      return {
        reminderType:
          "recurring",

        intervalMinutes,
      };
    }


    // --------------------------------------------------------
    // EVERY X DAYS
    // --------------------------------------------------------

    match =
      normalized.match(
        /every\s+(\d+)\s*(day|days)/
      );


    if (match) {

      const intervalMinutes =
        Number(match[1]) *
        24 *
        60;


      return {
        reminderType:
          "recurring",

        intervalMinutes,
      };
    }


    throw new Error(
      `Could not understand recurring time: ${timeText}`
    );
  }


  // ==========================================================
  // ONE-TIME REMINDER
  // ==========================================================

  /*
   * IMPORTANT:
   *
   * Use India timezone for interpreting:
   *
   * tomorrow at 8 AM
   * today at 12 PM
   * Monday at 10 AM
   *
   * This prevents Render's UTC timezone from changing
   * the intended local date/time.
   */

  const now =
    DateTime.now()
      .setZone(
        DEFAULT_TIMEZONE
      );


  console.log(
    "🌍 Assistant timezone:",
    DEFAULT_TIMEZONE
  );

  console.log(
    "🕐 Current assistant time:",
    now.toISO()
  );


  // ==========================================================
  // CHRONO PARSE
  // ==========================================================

  const parsedResults =
    chrono.parse(
      timeText,
      now.toJSDate(),
      {
        forwardDate: true,
      }
    );


  if (
    !parsedResults ||
    parsedResults.length === 0
  ) {

    throw new Error(
      `Could not understand reminder time: ${timeText}`
    );
  }


  const parsed =
    parsedResults[0];


  console.log(
    "🔎 Chrono parsed:",
    parsed.text
  );


  // ==========================================================
  // EXTRACT DATE COMPONENTS
  // ==========================================================

  const components =
    parsed.start;


  const year =
    components.get(
      "year"
    );

  const month =
    components.get(
      "month"
    );

  const day =
    components.get(
      "day"
    );


  const hour =
    components.isCertain(
      "hour"
    )
      ? components.get(
          "hour"
        )
      : 0;


  const minute =
    components.isCertain(
      "minute"
    )
      ? components.get(
          "minute"
        )
      : 0;


  const second =
    components.isCertain(
      "second"
    )
      ? components.get(
          "second"
        )
      : 0;


  // ==========================================================
  // BUILD INDIA DATE
  // ==========================================================

  const scheduledDate =
    DateTime.fromObject(
      {
        year,
        month,
        day,

        hour,
        minute,
        second,

        millisecond: 0,
      },
      {
        zone:
          DEFAULT_TIMEZONE,
      }
    );


  if (
    !scheduledDate.isValid
  ) {

    throw new Error(
      `Invalid reminder date: ${scheduledDate.invalidReason}`
    );
  }


  // ==========================================================
  // PREVENT PAST TIMES
  // ==========================================================

  if (
    scheduledDate <= now
  ) {

    /*
     * If the user said only a clock time and it is already
     * past today, move it to tomorrow.
     */

    const hasExplicitDate =
      components.isCertain(
        "day"
      ) ||
      components.isCertain(
        "month"
      ) ||
      components.isCertain(
        "year"
      ) ||
      /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
        timeText
      );


    if (!hasExplicitDate) {

      const tomorrow =
        scheduledDate.plus({
          days: 1,
        });


      return {
        reminderType:
          "one_time",

        scheduledFor:
          tomorrow.toUTC().toISO(),

        timezone:
          DEFAULT_TIMEZONE,
      };
    }
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  const result = {
    reminderType:
      "one_time",

    scheduledFor:
      scheduledDate
        .toUTC()
        .toISO(),

    timezone:
      DEFAULT_TIMEZONE,
  };


  console.log(
    "✅ Final reminder schedule:",
    result
  );


  return result;
};


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  parseReminderTime,
};
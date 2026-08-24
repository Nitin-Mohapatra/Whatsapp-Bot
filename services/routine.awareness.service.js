const User = require("../models/user.model");

const {
  sendWhatsAppMessage,
} = require("./whatsapp.service");


// ============================================================
// CONFIGURATION
// ============================================================

// How many minutes before the routine should we detect it?
const ROUTINE_WINDOW_MINUTES = 10;


// Prevent the same routine from being suggested repeatedly
// during the same minute window.
const SUGGESTION_COOLDOWN_MINUTES = 60;


// ============================================================
// PARSE ROUTINE TIME
// ============================================================

const parseRoutineTime = (timeText) => {

  if (
    !timeText ||
    typeof timeText !== "string"
  ) {
    return null;
  }

  const text =
    timeText
      .trim()
      .toLowerCase();


  // ----------------------------------------------------------
  // 7 PM
  // ----------------------------------------------------------

  let match =
    text.match(
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/
    );


  if (match) {

    let hour =
      Number(match[1]);

    const minute =
      Number(match[2] || 0);

    const period =
      match[3];


    if (
      period === "pm" &&
      hour !== 12
    ) {
      hour += 12;
    }


    if (
      period === "am" &&
      hour === 12
    ) {
      hour = 0;
    }


    return {
      hour,
      minute,
    };
  }


  // ----------------------------------------------------------
  // 19:00
  // ----------------------------------------------------------

  match =
    text.match(
      /^(\d{1,2}):(\d{2})$/
    );


  if (match) {

    return {
      hour:
        Number(match[1]),

      minute:
        Number(match[2]),
    };
  }


  return null;
};


// ============================================================
// CHECK WHETHER ROUTINE IS NEAR
// ============================================================

const isRoutineNear = (
  routine,
  now = new Date()
) => {

  if (
    !routine ||
    routine.enabled === false
  ) {
    return false;
  }


  const parsed =
    parseRoutineTime(
      routine.time
    );


  if (!parsed) {

    console.log(
      `⚠️ Could not parse routine time: ${routine.time}`
    );

    return false;
  }


  const routineTime =
    new Date(now);


  routineTime.setHours(
    parsed.hour,
    parsed.minute,
    0,
    0
  );


  const difference =
    routineTime.getTime() -
    now.getTime();


  const differenceMinutes =
    difference / 60000;


  return (
    differenceMinutes >= 0 &&
    differenceMinutes <=
      ROUTINE_WINDOW_MINUTES
  );
};


// ============================================================
// DAY CHECK
// ============================================================

const isRoutineDay = (
  routine,
  now = new Date()
) => {

  // Empty days means every day
  if (
    !routine.days ||
    routine.days.length === 0
  ) {
    return true;
  }


  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];


  const today =
    dayNames[
      now.getDay()
    ];


  return routine.days.some(
    (day) =>
      String(day)
        .toLowerCase()
        === today
  );
};


// ============================================================
// CHECK ROUTINE
// ============================================================

const checkUserRoutines = async (
  user
) => {

  if (
    !user ||
    !user.routines ||
    user.routines.length === 0
  ) {
    return;
  }


  const now =
    new Date();


  for (
    const routine of user.routines
  ) {

    try {

      if (
        !routine.enabled
      ) {
        continue;
      }


      if (
        !isRoutineDay(
          routine,
          now
        )
      ) {
        continue;
      }


      if (
        !isRoutineNear(
          routine,
          now
        )
      ) {
        continue;
      }


      console.log(
        `🧠 Routine detected for ${user.phoneNumber}: ${routine.name} at ${routine.time}`
      );


      // ------------------------------------------------------
      // PROACTIVE MESSAGE
      // ------------------------------------------------------

      const name =
        user.profile?.name ||
        "";


      const greeting =
        name
          ? `Hey ${name}`
          : "Hey";


      const suggestion =
        `${greeting}, it's almost your usual ${routine.name} time. 🌿\n\n` +
        `You usually do this around ${routine.time}.\n` +
        `Want me to remind you?`;


      // ------------------------------------------------------
      // FOR NOW ONLY LOG
      // ------------------------------------------------------

      console.log(
        "💡 PROACTIVE ROUTINE SUGGESTION:"
      );

      console.log(
        suggestion
      );


      /*
      --------------------------------------------------------
      DO NOT SEND WHATSAPP YET
      --------------------------------------------------------

      We are testing the proactive engine first.

      Later we will enable:

      await sendWhatsAppMessage(
        user.phoneNumber,
        suggestion
      );

      --------------------------------------------------------
      */

    } catch (error) {

      console.error(
        `❌ Routine check failed for ${user.phoneNumber}:`,
        error.message
      );
    }
  }
};


// ============================================================
// CHECK ALL USERS
// ============================================================

const checkRoutineAwareness =
  async () => {

    try {

      const users =
        await User.find({
          "routines.0": {
            $exists: true,
          },
        });


      if (
        users.length === 0
      ) {

        return;
      }


      console.log(
        `🧠 Checking routines for ${users.length} user(s)...`
      );


      for (
        const user of users
      ) {

        await checkUserRoutines(
          user
        );
      }

    } catch (error) {

      console.error(
        "❌ Routine awareness error:",
        error.message
      );
    }
  };


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  checkRoutineAwareness,
  checkUserRoutines,
  isRoutineNear,
  isRoutineDay,
  parseRoutineTime,
};
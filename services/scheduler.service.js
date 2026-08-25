const {
  processDueReminders,
} = require("./reminder.scheduler.service");


const {
  checkForNoReplyReminders,
} = require("./reminder.escalation.service");


const {
  checkRoutineAwareness,
} = require("./routine.awareness.service");


// ============================================================
// START SCHEDULER
// ============================================================

const startScheduler = () => {

  console.log(
    "======================================"
  );

  console.log(
    "⏰ REMINDER SCHEDULER STARTED"
  );

  console.log(
    "======================================"
  );


  // ========================================================
  // REMINDER CHECK
  // ========================================================

  setInterval(
    async () => {

      try {

        await processDueReminders();

      } catch (error) {

        console.error(
          "❌ Reminder scheduler error:",
          error.message
        );
      }

    },

    10 * 1000
  );


  // ========================================================
  // NO REPLY / TWILIO
  // ========================================================

  setInterval(
    async () => {

      try {

        await checkForNoReplyReminders();

      } catch (error) {

        console.error(
          "❌ Escalation scheduler error:",
          error.message
        );
      }

    },

    10 * 1000
  );


  // ========================================================
  // ROUTINE AWARENESS
  // ========================================================

  setInterval(
    async () => {

      try {

        await checkRoutineAwareness();

      } catch (error) {

        console.error(
          "❌ Routine scheduler error:",
          error.message
        );
      }

    },

    60 * 1000
  );


  console.log(
    "⏰ Reminder polling: every 10 seconds"
  );

  console.log(
    "📞 Escalation polling: every 10 seconds"
  );

  console.log(
    "🧠 Routine polling: every 60 seconds"
  );
};


module.exports = {
  startScheduler,
};
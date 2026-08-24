const {
  processDueReminders,
} = require("./reminder.scheduler.service");


const {
  checkForNoReplyReminders,
} = require("./reminder.escalation.service");


const {
  checkRoutineAwareness,
} = require("./routine.awareness.service");


const startScheduler = () => {

  console.log(
    "⏰ Reminder scheduler started"
  );


  // ========================================================
  // REMINDER CHECK
  // ========================================================

  setInterval(
    async () => {

      await processDueReminders();

    },
    10 * 1000
  );


  // ========================================================
  // NO REPLY CHECK
  // ========================================================

  setInterval(
    async () => {

      await checkForNoReplyReminders();

    },
    10 * 1000
  );


  // ========================================================
  // ROUTINE AWARENESS
  // ========================================================

  setInterval(
    async () => {

      await checkRoutineAwareness();

    },
    60 * 1000
  );


  console.log(
    "🧠 Routine awareness scheduler started"
  );
};


module.exports = {
  startScheduler,
};
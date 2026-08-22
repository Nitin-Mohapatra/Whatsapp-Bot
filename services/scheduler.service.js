const {
  processDueReminders,
} = require("./reminder.scheduler.service");

const {
  checkForNoReplyReminders,
} = require("./reminder.escalation.service");

const startScheduler = () => {
  console.log("⏰ Reminder scheduler started");

  // Check for due reminders every 10 seconds
  setInterval(async () => {
    await processDueReminders();
  }, 10 * 1000);

  // Check for reminders with no reply every 10 seconds
  setInterval(async () => {
    await checkForNoReplyReminders();
  }, 10 * 1000);
};

module.exports = {
  startScheduler,
};
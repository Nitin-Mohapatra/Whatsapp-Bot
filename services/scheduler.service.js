const {
  processDueReminders,
} = require("./reminder.scheduler.service");

const startScheduler = () => {
  console.log("⏰ Reminder scheduler started");

  // Check every 10 seconds for prototype
  setInterval(async () => {
    await processDueReminders();
  }, 10 * 1000);
};

module.exports = {
  startScheduler,
};
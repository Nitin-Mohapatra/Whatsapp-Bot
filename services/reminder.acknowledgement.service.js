const Reminder = require("../models/reminder.model");

const acknowledgeLatestReminder = async (phoneNumber) => {
    const reminder = await Reminder.findOne({
        phoneNumber,
        acknowledged: false,
        lastSentAt: { $ne: null },
        status: { $ne: "cancelled" }
    }).sort({
        lastSentAt: -1
    });

    if (!reminder) {
        return {
            acknowledged: false,
            reminder: null
        };
    }

    reminder.acknowledged = true;
    reminder.acknowledgedAt = new Date();

    // One-time reminders are completed after user replies.
    if (reminder.reminderType === "one_time") {
        reminder.status = "completed";
    }

    await reminder.save();

    console.log(
        `Reminder acknowledged by ${phoneNumber}: ${reminder.task}`
    );

    return {
        acknowledged: true,
        reminder
    };
};

module.exports = {
    acknowledgeLatestReminder
};
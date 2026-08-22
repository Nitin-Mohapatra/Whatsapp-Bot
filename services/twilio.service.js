const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const makeReminderCall = async ({
  phoneNumber,
  task,
}) => {
  try {
    const to = `+${phoneNumber.replace("+", "")}`;

    const twimlUrl =
      `${process.env.TWILIO_TWIML_BIN_URL}` +
      `?Task=${encodeURIComponent(task)}`;

    console.log("📞 Twilio call URL:", twimlUrl);

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: twimlUrl,
    });

    console.log(
      `📞 Twilio call created: ${call.sid}`
    );

    console.log(
      `📞 Calling ${phoneNumber} for task: ${task}`
    );

    return call;

  } catch (error) {
    console.error(
      "❌ Twilio call failed:",
      error.message
    );

    throw error;
  }
};

module.exports = {
  makeReminderCall,
};
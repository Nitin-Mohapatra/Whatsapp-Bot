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
    if (!phoneNumber) {
      throw new Error("Phone number is required");
    }

    if (!task) {
      throw new Error("Task is required");
    }

    if (!process.env.TWILIO_PHONE_NUMBER) {
      throw new Error(
        "TWILIO_PHONE_NUMBER is missing"
      );
    }

    if (!process.env.TWILIO_TWIML_BIN_URL) {
      throw new Error(
        "TWILIO_TWIML_BIN_URL is missing"
      );
    }

    // Convert database number:
    // 919876543210
    // into:
    // +919876543210

    const to = `+${phoneNumber.replace("+", "")}`;

    // Twilio TwiML Bin supports custom
    // query-string parameters.
    //
    // Example:
    // ?Task=Call%20Mom

    const twimlUrl =
      `${process.env.TWILIO_TWIML_BIN_URL}` +
      `?Task=${encodeURIComponent(task)}`;

    console.log(
      "📞 Starting Twilio reminder call"
    );

    console.log(
      "📱 To:",
      to
    );

    console.log(
      "📞 From:",
      process.env.TWILIO_PHONE_NUMBER
    );

    console.log(
      "📝 Task:",
      task
    );

    console.log(
      "🔗 TwiML URL:",
      twimlUrl
    );

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: twimlUrl,
    });

    console.log(
      `✅ Twilio call created: ${call.sid}`
    );

    console.log(
      `📊 Call status: ${call.status}`
    );

    return call;

  } catch (error) {

    console.error(
      "❌ Twilio call failed:",
      error.response?.data || error.message
    );

    throw error;
  }
};

module.exports = {
  makeReminderCall,
};
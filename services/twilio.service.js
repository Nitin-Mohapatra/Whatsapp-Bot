const twilio = require("twilio");

// -----------------------------------------
// TWILIO CLIENT
// -----------------------------------------

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);


// -----------------------------------------
// MAKE REMINDER CALL
// -----------------------------------------

const makeReminderCall = async ({
  phoneNumber,
  task,
}) => {
  try {

    // -----------------------------------------
    // VALIDATION
    // -----------------------------------------

    if (!phoneNumber) {
      throw new Error("Phone number is required");
    }

    if (!task) {
      throw new Error("Task is required");
    }

    if (!process.env.TWILIO_PHONE_NUMBER) {
      throw new Error(
        "TWILIO_PHONE_NUMBER is missing from environment variables"
      );
    }


    // -----------------------------------------
    // FORMAT PHONE NUMBER
    // -----------------------------------------

    const to = `+${phoneNumber.replace("+", "")}`;

    const from = process.env.TWILIO_PHONE_NUMBER;


    // -----------------------------------------
    // CREATE TWIML
    // -----------------------------------------

    const twiml = `
      <Response>
        <Say voice="alice">
          Hello. This is your Reminder P A.
          You have a reminder to ${escapeXml(task)}.
          Please take action now.
        </Say>
      </Response>
    `;


    console.log("📞 Starting Twilio reminder call");
    console.log("📱 To:", to);
    console.log("📞 From:", from);
    console.log("📝 Task:", task);


    // -----------------------------------------
    // CREATE CALL
    // -----------------------------------------

    const call = await client.calls.create({
      to,
      from,
      twiml,
    });


    // -----------------------------------------
    // SUCCESS LOG
    // -----------------------------------------

    console.log(
      `✅ Twilio call created successfully: ${call.sid}`
    );

    console.log(
      `📞 Calling ${to} for task: ${task}`
    );

    console.log(
      `📊 Call status: ${call.status}`
    );


    return call;

  } catch (error) {

    console.error(
      "❌ Twilio call failed:",error
    );

    throw error;
  }
};


// -----------------------------------------
// ESCAPE XML
// -----------------------------------------
// Prevent special characters in task text
// from breaking the TwiML XML.
// -----------------------------------------

const escapeXml = (text) => {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};


// -----------------------------------------
// EXPORT
// -----------------------------------------

module.exports = {
  makeReminderCall,
};
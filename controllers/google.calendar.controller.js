const {
  exchangeCodeForTokens,
  getCalendarConnection,
} = require("../services/google.calendar.service");

const {
  sendWhatsAppMessage,
} = require("../services/whatsapp.service");

// ============================================================
// GOOGLE CALENDAR OAUTH CALLBACK
// ============================================================

const googleCalendarCallback = async (
  req,
  res
) => {
  console.log(
    "[CALENDAR] OAuth callback received"
  );

  const {
    code,
    state,
    error,
  } = req.query;

  // ==========================================================
  // USER DENIED GOOGLE AUTHORIZATION
  // ==========================================================

  if (error) {
    console.log(
      "[CALENDAR] Google authorization failed:",
      error
    );

    return res.status(400).send(`
      <html>
        <head>
          <title>Google Calendar Not Connected</title>
        </head>

        <body style="
          font-family: Arial, sans-serif;
          padding: 40px;
          text-align: center;
        ">

          <h2>❌ Google Calendar Not Connected</h2>

          <p>
            Google Calendar authorization was not completed.
          </p>

          <p>
            You can close this window and return to WhatsApp.
          </p>

        </body>
      </html>
    `);
  }

  // ==========================================================
  // MISSING OAUTH DATA
  // ==========================================================

  if (!code || !state) {
    console.log(
      "[CALENDAR] Missing OAuth code or state"
    );

    return res.status(400).send(`
      <html>
        <head>
          <title>Google Calendar Not Connected</title>
        </head>

        <body style="
          font-family: Arial, sans-serif;
          padding: 40px;
          text-align: center;
        ">

          <h2>❌ Google Calendar Not Connected</h2>

          <p>
            Missing Google authorization details.
          </p>

          <p>
            Please return to WhatsApp and request a new connection link.
          </p>

        </body>
      </html>
    `);
  }

  // ==========================================================
  // EXCHANGE GOOGLE CODE FOR TOKENS
  // ==========================================================

  try {
    const phoneNumber =
      await exchangeCodeForTokens({
        code,
        state,
      });

    console.log(
      "[CALENDAR] Google tokens received"
    );

    // ========================================================
    // VERIFY CONNECTION
    // ========================================================

    const connection =
      await getCalendarConnection(
        phoneNumber
      );

    console.log(
      "[CALENDAR] Connection status:",
      connection
    );

    // ========================================================
    // SUCCESS
    // ========================================================

    if (
      connection.connected === true
    ) {
      console.log(
        "✅ Google Calendar connected successfully"
      );

      // ------------------------------------------------------
      // SEND WHATSAPP CONFIRMATION
      // ------------------------------------------------------

      try {
        const emailText =
          connection.email
            ? `\n📧 Account: ${connection.email}`
            : "";

        await sendWhatsAppMessage(
          phoneNumber,

          "✅ Google Calendar connected successfully! 🎉" +
            emailText +
            "\n\nYou can now use your calendar with your AI PA."
        );

        console.log(
          "[CALENDAR] Success message sent to WhatsApp"
        );

      } catch (
        whatsappError
      ) {
        console.error(
          "[CALENDAR] Failed to send WhatsApp success message:",
          whatsappError.message
        );
      }

      // ------------------------------------------------------
      // BROWSER RESPONSE
      // ------------------------------------------------------

      return res.send(`
        <html>
          <head>
            <title>Google Calendar Connected</title>
          </head>

          <body style="
            font-family: Arial, sans-serif;
            padding: 40px;
            text-align: center;
          ">

            <h2>✅ Google Calendar Connected</h2>

            <p>
              Your Google Calendar has been connected successfully.
            </p>

            <p>
              You can close this window and return to WhatsApp.
            </p>

          </body>
        </html>
      `);
    }

    // ========================================================
    // CONNECTION NOT CONFIRMED
    // ========================================================

    console.log(
      "⚠️ Google Calendar tokens exchanged but connection was not confirmed"
    );

    try {
      await sendWhatsAppMessage(
        phoneNumber,

        "⚠️ Google Calendar authorization completed, but I couldn't confirm the connection.\n\nPlease try connecting your Google Calendar again."
      );

    } catch (
      whatsappError
    ) {
      console.error(
        "[CALENDAR] Failed to send WhatsApp failure message:",
        whatsappError.message
      );
    }

    return res.status(400).send(`
      <html>
        <head>
          <title>Google Calendar Not Connected</title>
        </head>

        <body style="
          font-family: Arial, sans-serif;
          padding: 40px;
          text-align: center;
        ">

          <h2>⚠️ Google Calendar Not Connected</h2>

          <p>
            The authorization completed, but the connection
            could not be confirmed.
          </p>

          <p>
            Please return to WhatsApp and try again.
          </p>

        </body>
      </html>
    `);

  } catch (
    callbackError
  ) {

    console.error(
      "[CALENDAR] Google OAuth callback failed:",
      callbackError.response?.data ||
        callbackError.message
    );

    return res.status(400).send(`
      <html>
        <head>
          <title>Google Calendar Connection Failed</title>
        </head>

        <body style="
          font-family: Arial, sans-serif;
          padding: 40px;
          text-align: center;
        ">

          <h2>❌ Google Calendar Connection Failed</h2>

          <p>
            Google Calendar could not be connected.
          </p>

          <p>
            Please return to WhatsApp and request
            a new connection link.
          </p>

        </body>
      </html>
    `);
  }
};


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  googleCalendarCallback,
};
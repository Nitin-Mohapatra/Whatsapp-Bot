const {
  exchangeCodeForTokens,
} = require("../services/google.calendar.service");

const googleCalendarCallback = async (
  req,
  res
) => {
  console.log("[CALENDAR] OAuth callback received");

  const {
    code,
    state,
    error,
  } = req.query;

  if (error) {
    return res.status(400).send(
      "Google Calendar authorization was not completed. You can close this window and try again from WhatsApp."
    );
  }

  if (!code || !state) {
    return res.status(400).send(
      "Missing Google Calendar authorization details. You can close this window and try again from WhatsApp."
    );
  }

  try {
    const phoneNumber =
      await exchangeCodeForTokens({
        code,
        state,
      });

    console.log("[CALENDAR] Google tokens received");
    console.log(
      "[CALENDAR] Google Calendar connected successfully"
    );

    return res.send(
      "Google Calendar connected successfully. You can close this window and return to WhatsApp."
    );
  } catch (callbackError) {
    console.error(
      "[CALENDAR] Google OAuth callback failed:",
      callbackError.response?.data ||
        callbackError.message
    );

    return res.status(400).send(
      "Google Calendar could not be connected. You can close this window and request a new connection link from WhatsApp."
    );
  }
};

module.exports = {
  googleCalendarCallback,
};
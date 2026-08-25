const { google } = require("googleapis");

const crypto = require("crypto");

const GoogleCalendar =
  require("../models/googleCalendar.model");

// ============================================================
// GOOGLE OAUTH CLIENT
// ============================================================

const createOAuthClient = () => {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GOOGLE_REDIRECT_URI
  ) {
    throw new Error(
      "Google Calendar environment variables are missing"
    );
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

// ============================================================
// AUTH URL
// ============================================================

const generateAuthUrl = async (
  phoneNumber
) => {
  const oauth2Client =
    createOAuthClient();

  const state =
    crypto.randomBytes(32).toString("hex");

  await GoogleCalendar.findOneAndUpdate(
    {
      phoneNumber,
    },
    {
      $set: {
        oauthState: state,
        oauthStateExpiresAt: new Date(
          Date.now() + 10 * 60 * 1000
        ),
        updatedAt: new Date(),
      },
      $setOnInsert: {
        phoneNumber,
        connected: false,
      },
    },
    {
      upsert: true,
    }
  );

  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  return oauth2Client.generateAuthUrl({
    access_type: "offline",

    prompt: "consent",

    scope: scopes,

    state,
  });
};

const exchangeCodeForTokens = async ({
  code,
  state,
}) => {
  const calendar =
    await GoogleCalendar.findOne({
      oauthState: state,
      oauthStateExpiresAt: {
        $gt: new Date(),
      },
    }).select(
      "+oauthState +oauthStateExpiresAt"
    );

  if (!calendar) {
    throw new Error("Invalid or expired Google OAuth state");
  }

  const oauth2Client =
    createOAuthClient();

  const tokenResponse =
    await oauth2Client.getToken(code);

  await saveGoogleTokens({
    phoneNumber: calendar.phoneNumber,
    tokens: tokenResponse.tokens,
  });

  await GoogleCalendar.updateOne(
    {
      _id: calendar._id,
    },
    {
      $set: {
        oauthState: null,
        oauthStateExpiresAt: null,
      },
    }
  );

  return calendar.phoneNumber;
};

// ============================================================
// SAVE GOOGLE TOKENS
// ============================================================

const saveGoogleTokens = async ({
  phoneNumber,
  tokens,
}) => {
  const oauth2Client =
    createOAuthClient();

  oauth2Client.setCredentials(
    tokens
  );

  let googleEmail = null;

  try {
    const oauth2 =
      google.oauth2({
        version: "v2",
        auth: oauth2Client,
      });

    const userInfo =
      await oauth2.userinfo.get();

    googleEmail =
      userInfo.data?.email ||
      null;
  } catch (error) {
    console.error(
      "⚠️ Could not fetch Google email:",
      error.message
    );
  }

  const existing =
    await GoogleCalendar.findOne({
      phoneNumber,
    });

  const data = {
    phoneNumber,

    googleEmail,

    accessToken:
      tokens.access_token ||
      existing?.accessToken ||
      null,

    refreshToken:
      tokens.refresh_token ||
      existing?.refreshToken ||
      null,

    tokenExpiry:
      tokens.expiry_date
        ? new Date(
            tokens.expiry_date
          )
        : existing?.tokenExpiry ||
          null,

    scope:
      tokens.scope
        ? tokens.scope.split(" ")
        : existing?.scope || [],

    connected: true,

    updatedAt: new Date(),
  };

  const calendar =
    await GoogleCalendar.findOneAndUpdate(
      {
        phoneNumber,
      },
      data,
      {
        upsert: true,
        new: true,
      }
    );

  console.log(
    "✅ Google Calendar connected:",
    phoneNumber
  );

  return calendar;
};

// ============================================================
// GET AUTHENTICATED CLIENT
// ============================================================

const getAuthenticatedClient =
  async (phoneNumber) => {
    const calendar =
      await GoogleCalendar.findOne({
        phoneNumber,
        connected: true,
      });

    if (!calendar) {
      return null;
    }

    const oauth2Client =
      createOAuthClient();

    oauth2Client.setCredentials({
      access_token:
        calendar.accessToken,

      refresh_token:
        calendar.refreshToken,

      expiry_date:
        calendar.tokenExpiry
          ? calendar.tokenExpiry.getTime()
          : undefined,
    });

    // --------------------------------------------------------
    // Save refreshed tokens automatically
    // --------------------------------------------------------

    oauth2Client.on(
      "tokens",
      async (tokens) => {
        try {
          const update = {};

          if (
            tokens.access_token
          ) {
            update.accessToken =
              tokens.access_token;
          }

          if (
            tokens.refresh_token
          ) {
            update.refreshToken =
              tokens.refresh_token;
          }

          if (
            tokens.expiry_date
          ) {
            update.tokenExpiry =
              new Date(
                tokens.expiry_date
              );
          }

          update.updatedAt =
            new Date();

          await GoogleCalendar.updateOne(
            {
              phoneNumber,
            },
            {
              $set: update,
            }
          );

        } catch (error) {
          console.error(
            "❌ Failed to save refreshed Google token:",
            error.message
          );
        }
      }
    );

    return oauth2Client;
  };

// ============================================================
// GET TODAY'S EVENTS
// ============================================================

const getTodaysEvents =
  async (phoneNumber) => {
    const auth =
      await getAuthenticatedClient(
        phoneNumber
      );

    if (!auth) {
      return {
        connected: false,
        events: [],
      };
    }

    const calendar =
      google.calendar({
        version: "v3",
        auth,
      });

    const now =
      new Date();

    const startOfDay =
      new Date(now);

    startOfDay.setHours(
      0,
      0,
      0,
      0
    );

    const endOfDay =
      new Date(now);

    endOfDay.setHours(
      23,
      59,
      59,
      999
    );

    const response =
      await calendar.events.list({
        calendarId: "primary",

        timeMin:
          startOfDay.toISOString(),

        timeMax:
          endOfDay.toISOString(),

        singleEvents: true,

        orderBy:
          "startTime",

        maxResults: 50,
      });

    const events =
      response.data.items || [];

    return {
      connected: true,

      events: events.map(
        (event) => ({
          id: event.id,

          title:
            event.summary ||
            "Untitled event",

          description:
            event.description ||
            null,

          location:
            event.location ||
            null,

          start:
            event.start
              ?.dateTime ||
            event.start?.date ||
            null,

          end:
            event.end
              ?.dateTime ||
            event.end?.date ||
            null,

          status:
            event.status ||
            null,

          htmlLink:
            event.htmlLink ||
            null,
        })
      ),
    };
};

// ============================================================
// CHECK CONNECTION
// ============================================================

const getCalendarConnection =
  async (phoneNumber) => {
    const calendar =
      await GoogleCalendar.findOne({
        phoneNumber,
      }).lean();

    if (!calendar) {
      return {
        connected: false,
        email: null,
      };
    }

    return {
      connected:
        calendar.connected === true,

      email:
        calendar.googleEmail ||
        null,
    };
};

// ============================================================
// DISCONNECT
// ============================================================

const disconnectCalendar =
  async (phoneNumber) => {
    await GoogleCalendar.updateOne(
      {
        phoneNumber,
      },
      {
        $set: {
          connected: false,

          accessToken: null,

          refreshToken: null,

          tokenExpiry: null,

          updatedAt:
            new Date(),
        },
      }
    );

    console.log(
      "🔌 Google Calendar disconnected:",
      phoneNumber
    );

    return {
      disconnected: true,
    };
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createOAuthClient,

  generateAuthUrl,

  exchangeCodeForTokens,

  saveGoogleTokens,

  getAuthenticatedClient,

  getTodaysEvents,

  getCalendarConnection,

  disconnectCalendar,
};
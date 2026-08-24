const User = require("../models/user.model");

/*
|--------------------------------------------------------------------------
| GET OR CREATE USER
|--------------------------------------------------------------------------
*/

const getOrCreateUser = async (phoneNumber) => {
  if (!phoneNumber) {
    throw new Error("phoneNumber is required");
  }

  let user = await User.findOne({
    phoneNumber,
  });

  if (!user) {
    user = await User.create({
      phoneNumber,
      lastInteractionAt: new Date(),
    });

    console.log(
      `👤 New assistant user created: ${phoneNumber}`
    );
  }

  return user;
};


/*
|--------------------------------------------------------------------------
| ADD RECENT CONTEXT
|--------------------------------------------------------------------------
*/

const addRecentContext = async ({
  phoneNumber,
  role,
  content,
}) => {
  if (!phoneNumber || !content) {
    return null;
  }

  const user =
    await getOrCreateUser(phoneNumber);

  user.recentContext.push({
    role,
    content,
    createdAt: new Date(),
  });

  /*
  Keep only the latest 20 messages.
  Complete WhatsApp history is already stored
  in the Message collection.
  */

  if (user.recentContext.length > 20) {
    user.recentContext =
      user.recentContext.slice(-20);
  }

  user.lastInteractionAt = new Date();

  await user.save();

  return user;
};


/*
|--------------------------------------------------------------------------
| GET RECENT CONTEXT
|--------------------------------------------------------------------------
*/

const getRecentContext = async (
  phoneNumber,
  limit = 10
) => {
  const user =
    await getOrCreateUser(phoneNumber);

  return user.recentContext
    .slice(-limit)
    .map((item) => ({
      role: item.role,
      content: item.content,
    }));
};


/*
|--------------------------------------------------------------------------
| ADD IMPORTANT FACT
|--------------------------------------------------------------------------
*/

const addImportantFact = async ({
  phoneNumber,
  fact,
}) => {
  if (!phoneNumber || !fact) {
    return null;
  }

  const user =
    await getOrCreateUser(phoneNumber);

  const cleanFact = fact.trim();

  if (!cleanFact) {
    return user;
  }

  const alreadyExists =
    user.importantFacts.some(
      (existingFact) =>
        existingFact.toLowerCase() ===
        cleanFact.toLowerCase()
    );

  if (!alreadyExists) {
    user.importantFacts.push(
      cleanFact
    );

    await user.save();

    console.log(
      `🧠 Memory saved for ${phoneNumber}: ${cleanFact}`
    );
  }

  return user;
};


/*
|--------------------------------------------------------------------------
| GET USER MEMORY
|--------------------------------------------------------------------------
*/

const getUserMemory = async (
  phoneNumber
) => {
  const user =
    await getOrCreateUser(phoneNumber);

  return {
    phoneNumber:
      user.phoneNumber,

    profile:
      user.profile,

    importantFacts:
      user.importantFacts,

    preferences:
      user.preferences,

    routines:
      user.routines,

    recentContext:
      user.recentContext
        .slice(-10)
        .map((item) => ({
          role: item.role,
          content: item.content,
        })),
  };
};


/*
|--------------------------------------------------------------------------
| UPDATE PREFERENCE
|--------------------------------------------------------------------------
*/

const setPreference = async ({
  phoneNumber,
  key,
  value,
}) => {
  if (
    !phoneNumber ||
    !key ||
    !value
  ) {
    return null;
  }

  const user =
    await getOrCreateUser(phoneNumber);

  const existingPreference =
    user.preferences.find(
      (preference) =>
        preference.key.toLowerCase() ===
        key.toLowerCase()
    );

  if (existingPreference) {
    existingPreference.value =
      value;
  } else {
    user.preferences.push({
      key,
      value,
    });
  }

  await user.save();

  console.log(
    `🧠 Preference saved for ${phoneNumber}: ${key} = ${value}`
  );

  return user;
};


/*
|--------------------------------------------------------------------------
| UPDATE PROFILE
|--------------------------------------------------------------------------
*/

const updateProfile = async ({
  phoneNumber,
  name,
  timezone,
}) => {
  const user =
    await getOrCreateUser(phoneNumber);

  if (name) {
    user.profile.name =
      name;
  }

  if (timezone) {
    user.profile.timezone =
      timezone;
  }

  await user.save();

  return user;
};


/*
|--------------------------------------------------------------------------
| BUILD MEMORY CONTEXT FOR AI
|--------------------------------------------------------------------------
*/

const buildMemoryContext = async (
  phoneNumber
) => {
  const memory =
    await getUserMemory(phoneNumber);

  const sections = [];


  /*
  Profile
  */

  if (memory.profile?.name) {
    sections.push(
      `Name: ${memory.profile.name}`
    );
  }

  if (memory.profile?.timezone) {
    sections.push(
      `Timezone: ${memory.profile.timezone}`
    );
  }


  /*
  Important facts
  */

  if (
    memory.importantFacts?.length
  ) {
    sections.push(
      `Important facts:\n- ${memory.importantFacts.join(
        "\n- "
      )}`
    );
  }


  /*
  Preferences
  */

  if (
    memory.preferences?.length
  ) {
    sections.push(
      `Preferences:\n- ${memory.preferences
        .map(
          (item) =>
            `${item.key}: ${item.value}`
        )
        .join("\n- ")}`
    );
  }


  /*
  Routines
  */

  if (
    memory.routines?.length
  ) {
    sections.push(
      `Routines:\n- ${memory.routines
        .map(
          (routine) =>
            `${routine.name} at ${
              routine.time ||
              "unspecified time"
            }`
        )
        .join("\n- ")}`
    );
  }


  /*
  Recent conversation
  */

  if (
    memory.recentContext?.length
  ) {
    sections.push(
      `Recent conversation:\n${memory.recentContext
        .map(
          (item) =>
            `${item.role}: ${item.content}`
        )
        .join("\n")}`
    );
  }


  if (!sections.length) {
    return "No stored memory about this user yet.";
  }

  return sections.join("\n\n");
};


/*
|--------------------------------------------------------------------------
| SAVE EXTRACTED MEMORY
|--------------------------------------------------------------------------
*/

const saveExtractedMemory = async ({
  phoneNumber,
  memory,
}) => {
  if (
    !phoneNumber ||
    !memory
  ) {
    return null;
  }

  if (
    memory.shouldRemember !== true
  ) {
    return null;
  }

  const {
    type,
    key,
    value,
  } = memory;

  if (
    !type ||
    !key ||
    !value
  ) {
    return null;
  }


  /*
  FACT
  */

  if (type === "fact") {
    return await addImportantFact({
      phoneNumber,
      fact: `${key}: ${value}`,
    });
  }


  /*
  PREFERENCE
  */

  if (type === "preference") {
    return await setPreference({
      phoneNumber,
      key,
      value,
    });
  }


  /*
  ROUTINE
  */

  if (type === "routine") {
    const user =
      await getOrCreateUser(
        phoneNumber
      );

    const existingRoutine =
      user.routines.find(
        (routine) =>
          routine.name.toLowerCase() ===
          key.toLowerCase()
      );

    if (existingRoutine) {
      existingRoutine.time =
        value;
    } else {
      user.routines.push({
        name: key,
        time: value,
        days: [],
        enabled: true,
      });
    }

    await user.save();

    console.log(
      `🧠 Routine saved for ${phoneNumber}: ${key} = ${value}`
    );

    return user;
  }

  return null;
};


/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {
  getOrCreateUser,
  addRecentContext,
  getRecentContext,
  addImportantFact,
  getUserMemory,
  setPreference,
  updateProfile,
  buildMemoryContext,
  saveExtractedMemory,
};
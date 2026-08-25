// services/time.service.js

const chrono = require("chrono-node");

/**
 * Normalize informal time expressions before passing them to chrono.
 *
 * Examples:
 * "10 40"       -> "10:40"
 * "10.40"       -> "10:40"
 * "10-40"       -> "10:40"
 * "10 40 am"    -> "10:40 am"
 * "at 10 40"    -> "at 10:40"
 */
function normalizeTimeText(text) {
  if (!text || typeof text !== "string") {
    return text;
  }

  let normalized = text.trim();

  // ---------------------------------------------------------
  // 1. Convert "10 40" -> "10:40"
  // ---------------------------------------------------------
  normalized = normalized.replace(
    /\b([01]?\d|2[0-3])\s+([0-5]\d)\b/g,
    "$1:$2"
  );

  // ---------------------------------------------------------
  // 2. Convert "10.40" -> "10:40"
  // ---------------------------------------------------------
  normalized = normalized.replace(
    /\b([01]?\d|2[0-3])\.([0-5]\d)\b/g,
    "$1:$2"
  );

  // ---------------------------------------------------------
  // 3. Convert "10-40" -> "10:40"
  // ---------------------------------------------------------
  normalized = normalized.replace(
    /\b([01]?\d|2[0-3])-([0-5]\d)\b/g,
    "$1:$2"
  );

  // ---------------------------------------------------------
  // 4. Normalize AM / PM spacing
  // ---------------------------------------------------------
  normalized = normalized.replace(
    /\b(\d{1,2}:\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi,
    "$1 $2"
  );

  // ---------------------------------------------------------
  // 5. Normalize "10am" -> "10 am"
  // ---------------------------------------------------------
  normalized = normalized.replace(
    /\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/gi,
    "$1 $2"
  );

  // ---------------------------------------------------------
  // 6. Normalize multiple spaces
  // ---------------------------------------------------------
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

/**
 * Extract a date/time from natural language.
 *
 * @param {string} text
 * @param {Date} referenceDate
 * @returns {Date|null}
 */
function parseDateTime(text, referenceDate = new Date()) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const normalizedText = normalizeTimeText(text);

  console.log("🕐 Original time text:", text);
  console.log("🕐 Normalized time text:", normalizedText);

  const results = chrono.parse(
    normalizedText,
    referenceDate,
    {
      forwardDate: false
    }
  );

  if (!results || results.length === 0) {
    console.log("❌ Could not parse date/time");
    return null;
  }

  const result = results[0];

  let parsedDate = result.start.date();

  console.log("🕐 Chrono parsed:", parsedDate);
  console.log("🕐 Parsed text:", result.text);

  // ---------------------------------------------------------
  // IMPORTANT:
  // If the user explicitly said tomorrow,
  // make sure the date is tomorrow.
  // ---------------------------------------------------------
  const lowerText = normalizedText.toLowerCase();

  if (/\btomorrow\b/.test(lowerText)) {
    parsedDate = new Date(referenceDate);
    parsedDate.setDate(parsedDate.getDate() + 1);

    const hour = result.start.knownValues("hour")
      ? result.start.get("hour")
      : null;

    const minute = result.start.knownValues("minute")
      ? result.start.get("minute")
      : 0;

    if (hour !== null) {
      parsedDate.setHours(hour);
      parsedDate.setMinutes(minute);
      parsedDate.setSeconds(0);
      parsedDate.setMilliseconds(0);

      // Handle AM/PM if available.
      if (result.start.knownValues("meridiem")) {
        const meridiem = result.start.get("meridiem");

        if (meridiem === 1 && parsedDate.getHours() === 12) {
          parsedDate.setHours(0);
        }

        if (meridiem === 2 && parsedDate.getHours() < 12) {
          parsedDate.setHours(parsedDate.getHours() + 12);
        }
      }
    }
  }

  // ---------------------------------------------------------
  // If "today" was explicitly mentioned, force today's date.
  // ---------------------------------------------------------
  if (/\btoday\b/.test(lowerText)) {
    const current = new Date(referenceDate);

    const hour = result.start.knownValues("hour")
      ? result.start.get("hour")
      : null;

    const minute = result.start.knownValues("minute")
      ? result.start.get("minute")
      : 0;

    if (hour !== null) {
      parsedDate = new Date(current);

      parsedDate.setHours(hour);
      parsedDate.setMinutes(minute);
      parsedDate.setSeconds(0);
      parsedDate.setMilliseconds(0);

      if (result.start.knownValues("meridiem")) {
        const meridiem = result.start.get("meridiem");

        if (meridiem === 1 && parsedDate.getHours() === 12) {
          parsedDate.setHours(0);
        }

        if (meridiem === 2 && parsedDate.getHours() < 12) {
          parsedDate.setHours(parsedDate.getHours() + 12);
        }
      }
    }
  }

  // ---------------------------------------------------------
  // If no explicit date was provided:
  //
  // Example:
  // "remind me at 10:40"
  //
  // If 10:40 is still in the future -> TODAY.
  //
  // If 10:40 already passed -> TOMORROW.
  // ---------------------------------------------------------
  const hasExplicitDate =
    /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      lowerText
    );

  if (!hasExplicitDate) {
    const now = new Date(referenceDate);

    const hasTime =
      result.start.knownValues("hour") ||
      result.start.knownValues("minute");

    if (hasTime) {
      const candidate = new Date(parsedDate);

      // chrono sometimes gives an unexpected date.
      candidate.setFullYear(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );

      if (candidate > now) {
        // Time is still ahead today.
        parsedDate = candidate;
      } else {
        // Time has already passed -> tomorrow.
        candidate.setDate(candidate.getDate() + 1);
        parsedDate = candidate;
      }
    }
  }

  // ---------------------------------------------------------
  // Safety: never return an invalid date
  // ---------------------------------------------------------
  if (Number.isNaN(parsedDate.getTime())) {
    console.log("❌ Invalid parsed date");
    return null;
  }

  console.log(
    "✅ Final scheduled time:",
    parsedDate.toISOString()
  );

  return parsedDate;
}

/**
 * Parse a reminder time and return useful information.
 *
 * Example:
 *
 * parseReminderTime("remind me to make timetable at 10 40")
 */
function parseReminderTime(text, referenceDate = new Date()) {
  if (!text || typeof text !== "string") {
    return {
      date: null,
      normalizedText: text || "",
      success: false
    };
  }

  const normalizedText = normalizeTimeText(text);

  const date = parseDateTime(
    normalizedText,
    referenceDate
  );

  return {
    date,
    normalizedText,
    success: !!date
  };
}

/**
 * Check whether text contains a recognizable time.
 */
function hasTime(text) {
  if (!text || typeof text !== "string") {
    return false;
  }

  const normalized = normalizeTimeText(text);

  const results = chrono.parse(normalized);

  return results.length > 0;
}

/**
 * Format Date for logs/debugging.
 */
function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

module.exports = {
  normalizeTimeText,
  parseDateTime,
  parseReminderTime,
  hasTime,
  formatDate
};
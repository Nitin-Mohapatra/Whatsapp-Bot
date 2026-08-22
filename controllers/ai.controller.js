const { parseReminder } = require("../services/ai.service");
const { parseReminderTime } = require("../services/time.service");

const testAI = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "message is required",
      });
    }

    const result = await parseReminder(message);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "AI parsing failed",
      error: error.message,
    });
  }
};

const testTimeParser = async (req, res) => {
  try {
    const { timeText, recurring } = req.body;

    if (!timeText) {
      return res.status(400).json({
        success: false,
        message: "timeText is required",
      });
    }

    const result = parseReminderTime(
      timeText,
      Boolean(recurring)
    );

    return res.json({
      success: true,
      data: result,
    });

  } catch (error) {
    console.error("Time parser error:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  testAI,
  testTimeParser,
};
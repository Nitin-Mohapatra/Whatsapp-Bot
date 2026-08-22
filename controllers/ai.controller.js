const { parseReminder } = require("../services/ai.service");

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

module.exports = {
  testAI,
};
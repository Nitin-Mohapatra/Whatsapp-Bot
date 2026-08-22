const {
  sendWhatsAppMessage,
} = require("../services/whatsapp.service");

const testMessage = async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        message: "phone and message are required",
      });
    }

    const result = await sendWhatsAppMessage(phone, message);

    res.json({
      success: true,
      message: "WhatsApp message sent",
      data: result,
    });
  } catch (error) {
    console.error(
      "WhatsApp error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      message: "Failed to send WhatsApp message",
      error: error.response?.data || error.message,
    });
  }
};

module.exports = {
  testMessage,
};
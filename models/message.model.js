const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    whatsappMessageId: {
      type: String,
      unique: true,
      sparse: true,
    },

    from: {
      type: String,
      required: true,
    },

    messageType: {
      type: String,
      required: true,
    },

    text: {
      type: String,
      default: "",
    },

    timestamp: {
      type: Date,
      default: Date.now,
    },

    rawPayload: {
      type: Object,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Message", messageSchema);
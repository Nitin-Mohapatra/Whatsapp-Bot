const express = require("express");
const cors = require("cors");

const whatsappRoutes = require("./routes/whatsapp.routes");
const webhookRoutes = require("./routes/webhook.routes");
const aiRoutes = require("./routes/ai.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Reminder PA backend is running",
  });
});

app.use("/api/whatsapp", whatsappRoutes);

app.use("/api/whatsapp", webhookRoutes);

app.use("/api/ai", aiRoutes);

module.exports = app;
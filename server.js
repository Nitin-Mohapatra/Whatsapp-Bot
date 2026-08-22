require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");
const { startScheduler } = require("./services/scheduler.service");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  startScheduler();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();
require("dotenv").config();

const app = require("./app");

const connectDB =
  require("./config/db");

const {
  startScheduler,
} = require("./services/scheduler.service");


const PORT =
  process.env.PORT || 5000;


// ============================================================
// START SERVER
// ============================================================

const startServer =
  async () => {

    try {

      // ------------------------------------------------------
      // DATABASE
      // ------------------------------------------------------

      await connectDB();

      console.log(
        "✅ MongoDB connected"
      );


      // ------------------------------------------------------
      // SCHEDULER
      // ------------------------------------------------------

      startScheduler();


      // ------------------------------------------------------
      // EXPRESS
      // ------------------------------------------------------

      app.listen(
        PORT,

        () => {

          console.log(
            `🚀 Server running on port ${PORT}`
          );

        }
      );

    } catch (error) {

      console.error(
        "❌ Server startup failed:",
        error.message
      );

      process.exit(
        1
      );
    }
  };


startServer();
import { startApp } from "./app.js";

startApp().catch((error) => {
  const message = error?.message || "Unexpected startup error.";
  const pill = document.getElementById("connection-pill");
  if (pill) {
    pill.textContent = "Startup error";
    pill.className = "pill bad";
  }

  const landingMessage = document.getElementById("landing-message");
  if (landingMessage) {
    landingMessage.textContent = message;
    landingMessage.className = "message error";
  }

  const landing = document.getElementById("landing-screen");
  const setup = document.getElementById("setup-screen");
  if (landing) {
    landing.classList.remove("hidden");
  }
  if (setup) {
    setup.classList.add("hidden");
  }

  console.error(error);
});

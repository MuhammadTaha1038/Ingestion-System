import "dotenv/config";
import assert from "node:assert/strict";
import { sendDirect } from "../../src/smtp/sendDirect.js";

const email = process.env.SMTP_TEST_EMAIL ?? process.env.GMAIL_SMTP_EMAIL;
const appPassword = process.env.SMTP_TEST_APP_PASSWORD ?? process.env.GMAIL_SMTP_APP_PASSWORD;

const run = async (): Promise<void> => {
  assert.ok(email, "SMTP_TEST_EMAIL or GMAIL_SMTP_EMAIL is required");
  assert.ok(appPassword, "SMTP_TEST_APP_PASSWORD or GMAIL_SMTP_APP_PASSWORD is required");

  const info = await sendDirect(
    {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      username: email,
      password: appPassword
    },
    email,
    "Phase 1 Gmail smoke test",
    "<p>Phase 1 Gmail smoke test</p>",
    "Phase 1 Gmail smoke test"
  );

  assert.ok(info.messageId, "messageId should be returned");
  console.log("Gmail SMTP smoke test sent", { messageId: info.messageId });
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

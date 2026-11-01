// Scheduled trigger for the Publishing Automation.
// Cron runs in UTC; "every 15 minutes" is the same in any time zone.
import type { Config } from "@netlify/functions";
import { runPublishingAutomation } from "../lib/automation.mts";

export default async () => {
  const run = await runPublishingAutomation("schedule");
  console.log("Publishing automation:", JSON.stringify(run.steps));
};

export const config: Config = { schedule: "*/15 * * * *" };

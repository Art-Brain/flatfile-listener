import type { FlatfileListener, FlatfileEvent } from "@flatfile/listener";
import api from "@flatfile/api";
import { REF_SHEETS } from "../config/lookups";

const SUBMIT_JOB = "workbook:simpleSubmitAction";
const IMPORT_SHEET_NAME = "Import";
/** Only alert when invalid records exceed this fraction of total records. */
const INVALID_THRESHOLD = 0.05;

export function submitSlackNotification(listener: FlatfileListener) {
  listener.on(
    "job:completed",
    { job: SUBMIT_JOB },
    async (event: FlatfileEvent) => {
      try {
        const { workbookId, spaceId } = event.context;
        const { data: sheets } = await api.sheets.list({ workbookId });
        const importSheet =
          sheets.find(
            (sheet) =>
              sheet.slug?.toLowerCase() &&
              !REF_SHEETS.includes(sheet.slug.toLowerCase()),
          ) ?? sheets[0];

        if (!importSheet) return;

        const {
          recordCounts = {
            total: 0,
            error: 0,
            valid: 0,
          },
        } = importSheet;
        const { total, error: invalid, valid } = recordCounts;

        if (total === 0) return;

        const ratio = invalid / total;

        if (ratio <= INVALID_THRESHOLD) return;

        const [{ data: workbook }, { data: space }] = await Promise.all([
          api.workbooks.get(workbookId),
          api.spaces.get(spaceId),
        ]);
        const token = await event.secrets("SLACK_TOKEN");
        const channel = await resolveChannel(event);

        if (!channel) {
          console.error(
            "Slack submit notification: no SLACK_CHANNEL configured",
          );
          return;
        }

        const percent = (ratio * 100).toFixed(1);
        const text =
          `@channel Warning: Submit completed with ${percent}% invalid records for space "${space.name}" / workbook "${workbook.name}": ` +
          `${valid} valid, ${invalid} invalid.`;

        await postSlackMessage(token, channel, text);
      } catch (err) {
        console.error("Slack submit notification failed:", err);
      }
    },
  );
}

async function resolveChannel(
  event: FlatfileEvent,
): Promise<string | undefined> {
  try {
    const channel = await event.secrets("SLACK_CHANNEL");
    if (channel) return channel;
  } catch {
    // Secret not set; fall back to the environment variable (local dev).
    console.error("Slack submit notification: no SLACK_CHANNEL configured");
  }
}

async function postSlackMessage(token: string, channel: string, text: string) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) {
    throw new Error(`Slack API error: ${body.error}`);
  }
}

import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const base = config.API_BASE_URL.replace(/\/$/, "");

  let prepareRes: Response;
  try {
    prepareRes = await fetch(`${base}/v1/bot/link/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Secret": config.BOT_API_SECRET,
      },
      body: JSON.stringify({
        discord_id: interaction.user.id,
        timezone: config.TIMEZONE,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    await interaction.editReply(
      `Link failed (timeout/network). ${err instanceof Error ? err.message : String(err)}`.slice(0, 180),
    );
    return;
  }

  if (!prepareRes.ok) {
    const detail = await prepareRes.text().catch(() => "");
    await interaction.editReply(`Link failed (${prepareRes.status}). ${detail.slice(0, 120)}`.trim());
    return;
  }

  const body = (await prepareRes.json()) as {
    discord_id: string;
    widget_token: string;
    pending_id: string;
  };
  const dmText =
    "Structured widget credentials:\n" +
    `Discord ID: \`${body.discord_id}\`\n` +
    `Widget token: \`${body.widget_token}\`\n` +
    "Paste both into the widget with your backend URL.\n" +
    "This token activates only after successful delivery.";

  try {
    await interaction.user.send(dmText);
  } catch {
    await interaction.editReply(
      "Could not DM you. Open DMs from server members, then run /link again. " +
        "Your existing widget token was NOT rotated.",
    );
    return;
  }

  try {
    const activateRes = await fetch(`${base}/v1/bot/link/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Secret": config.BOT_API_SECRET,
      },
      body: JSON.stringify({
        discord_id: interaction.user.id,
        pending_id: body.pending_id,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!activateRes.ok) {
      const detail = await activateRes.text().catch(() => "");
      await interaction.editReply(
        `Credentials DMed, but activation failed (${activateRes.status}). ` +
          `${detail.slice(0, 100)}. Run /link again.`.trim(),
      );
      return;
    }
  } catch (err) {
    await interaction.editReply(
      `Credentials DMed, but activation failed: ${err instanceof Error ? err.message : String(err)}. Run /link again.`,
    );
    return;
  }

  await interaction.editReply("Sent credentials via DM. Old token (if any) is now invalid.");
}

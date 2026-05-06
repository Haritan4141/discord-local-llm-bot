import "dotenv/config";
import { REST, Routes } from "discord.js";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

function parseGuildIds(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

const guildIds = parseGuildIds(process.env.GUILD_ID);
if (!guildIds.length) {
  throw new Error("GUILD_ID が設定されていません。ギルド削除ではカンマ区切りで複数指定できます。");
}

for (const guildId of guildIds) {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
    { body: [] }
  );
  console.log(`🧹 Cleared GUILD commands: ${guildId}`);
}

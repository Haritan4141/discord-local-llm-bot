import "dotenv/config";
import { REST, Routes } from "discord.js";

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// グローバル（全体）コマンドを全削除
await rest.put(
  Routes.applicationCommands(process.env.CLIENT_ID),
  { body: [] }
);

console.log("✅ Cleared GLOBAL commands");

import { Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { handleButtonInteraction, handleChatInputCommand, handleModalSubmit } from "./botHandlers.js";
import { postDashboardPanel } from "./dashboard.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
logger.warn("DISCORD_BOT_TOKEN not set; skipping Discord bot");
return;
    }
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages], partials: [Partials.Channel] });
discordClient = client;

client.on("ready", () => {
    logger.info("discord bot ready", { user: client.user?.tag });
    void postDashboardPanel(client);
    setInterval(() => {
        void postDashboardPanel(client).catch(err => logger.error("failed to update dashboard interval", { error: String(err) }));
    }, 30000);
});

client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
            return;
        }

        if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
            // handle selection menus (campaign/dataset choices)
            const { handleSelectMenu } = await import("./botHandlers.js");
            await handleSelectMenu(interaction);
            return;
        }

        if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
            return;
        }

        if (interaction.isChatInputCommand()) {
            await handleChatInputCommand(interaction);
            return;
        }
    } catch (error: any) { N ERROR STACK END-- -\n');
    } catch { }
    logger.error("discord interaction failed", { error: errString, stack: errStack });
    if (interaction.isRepliable()) {
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply("command_error");
            } else {
                await interaction.reply({ content: "command_error", ephemeral: true });
            }
        } catch {
            // ignore reply failure
        }
    }
}
    });

await client.login(token);
};

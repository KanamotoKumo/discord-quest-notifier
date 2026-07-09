// ─── Main ─────────────────────────────────────────────────────────────────
import {
    fetchQuests,
    buildNewQuestEmbed,
    buildUpdatedQuestEmbed,
    i18n,
    log,
    warn,
    error,
    info,
    loadState,
    saveState,
    hashQuestData,
    sendWebhook,
    sendErrorNotice,
    detectQuestChanges
} from './module.js';
import { DISCORD_TOKEN, MAIN_WEBHOOK, PING_ROLE_ID, REPOSITORY, ERROR_WEBHOOK, GITHUB_TOKEN } from './config.js';

// Validate config
if (!DISCORD_TOKEN || !MAIN_WEBHOOK || !GITHUB_TOKEN || !REPOSITORY) {
    console.error('❌ Missing required environment variables: DISCORD_TOKEN, MAIN_WEBHOOK, GITHUB_TOKEN, REPOSITORY');
    process.exit(1);
}

/**
 * Fetch image assets from GitHub
 */
const getAttachments = async (path) => {
    const githubUrl = `https://raw.githubusercontent.com/${REPOSITORY}/refs/heads/main/assets/${path}`;
    try {
        const response = new URL(githubUrl);
        response.searchParams.append('uuid', crypto.randomUUID());
        return response.href;
    } catch (err) {
        error(`Failed to fetch assets: ${err.message}`);
        return null;
    }
};

/**
 * Main tracker function
 */
async function main() {
    log('Starting quest tracker...');
    const state = loadState();
    let quests;

    try {
        quests = await fetchQuests();
    } catch (err) {
        error(`Fetch failed: ${err.message}`);
        await sendErrorNotice(err.message);
        process.exit(1);
    }

    log(`Found ${quests.length} active quest(s).`);

    const now = new Date();

    // Categorize quests
    const questMap = new Map(quests.map(q => [q.id, q]));
    const newQuests = [];
    const updatedQuests = [];

    for (const quest of quests) {
        const hasConfig = quest.config && quest.config.expires_at;
        const isNotExpired = hasConfig ? new Date(quest.config.expires_at) > now : false;

        if (!isNotExpired) continue; // Skip expired quests

        const inState = state.quests[quest.id];

        if (!inState) {
            // NEW quest
            newQuests.push(quest);
        } else {
            // Check if updated
            const changes = detectQuestChanges(inState, quest);
            const hasChanges = Object.values(changes).some(v => v);

            if (hasChanges) {
                updatedQuests.push({ quest, changes, oldQuest: inState });
            }
        }
    }

    // Sort new quests by start time
    newQuests.sort((a, b) => {
        const timeA = new Date(a.config?.starts_at || 0).getTime();
        const timeB = new Date(b.config?.starts_at || 0).getTime();
        return timeA - timeB;
    });

    // Report summary
    if (newQuests.length > 0) {
        log(`Found ${newQuests.length} new quest(s).`);
    }
    if (updatedQuests.length > 0) {
        log(`Found ${updatedQuests.length} updated quest(s).`);
    }
    if (newQuests.length === 0 && updatedQuests.length === 0) {
        log('No new or updated quests.');
    }

    // Process new & updated quests
    if (newQuests.length > 0 || updatedQuests.length > 0) {
        log('Fetching assets from GitHub...');
        let avatarWebhook = await getAttachments('avatar.png');
        if (!avatarWebhook) avatarWebhook = await getAttachments('discord.webp');

        const rewardIconUrl = 'https://cdn.discordapp.com/assets/content/fb761d9c206f93cd8c4e7301798abe3f623039a4054f2e7accd019e1bb059fc8.webm';
        const emptyIconUrl = await getAttachments('empty.png');
        const discordQuests = await getAttachments('discordQuests.png');
        const globalAssets = { avatarWebhook, rewardIconUrl, emptyIconUrl, discordQuests };

        // Send new quests
        if (newQuests.length > 0) {
            log(`Sending ${newQuests.length} new quest notification(s)...`);
            for (const quest of newQuests) {
                try {
                    const content = PING_ROLE_ID ? `<@&${PING_ROLE_ID}>` : '';
                    const embed = await buildNewQuestEmbed(content, quest, globalAssets);
                    await sendWebhook(MAIN_WEBHOOK, embed, true);

                    const expiresAt = quest.config?.rewards_config?.rewards_expire_at || quest.config?.expires_at || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
                    state.quests[quest.id] = {
                        id: quest.id,
                        config: quest.config,
                        hash: hashQuestData(quest),
                        starts_at: quest.config?.starts_at,
                        expires_at: expiresAt,
                        sent_at: new Date().toISOString(),
                        type: 'new'
                    };

                    log(`✅ Sent new quest: ${quest.id}`);
                    await new Promise(r => setTimeout(r, 1100));
                } catch (err) {
                    error(`Failed to send new quest ${quest.id}: ${err.message}`);
                    await sendErrorNotice(`New Quest ${quest.id}: ${err.message}`);
                }
            }
        }

        // Send updated quests
        if (updatedQuests.length > 0) {
            log(`Sending ${updatedQuests.length} updated quest notification(s)...`);
            for (const { quest, changes, oldQuest } of updatedQuests) {
                try {
                    const content = PING_ROLE_ID ? `<@&${PING_ROLE_ID}>` : '';
                    const embed = await buildUpdatedQuestEmbed(content, oldQuest, quest, globalAssets, changes);
                    await sendWebhook(MAIN_WEBHOOK, embed, true);

                    // Update state
                    state.quests[quest.id] = {
                        ...state.quests[quest.id],
                        config: quest.config,
                        hash: hashQuestData(quest),
                        expires_at: quest.config?.expires_at,
                        updated_at: new Date().toISOString(),
                        type: 'updated'
                    };

                    log(`✅ Sent updated quest: ${quest.id}`);
                    await new Promise(r => setTimeout(r, 1100));
                } catch (err) {
                    error(`Failed to send updated quest ${quest.id}: ${err.message}`);
                    await sendErrorNotice(`Updated Quest ${quest.id}: ${err.message}`);
                }
            }
        }

        saveState(state);
    }

    // Cleanup expired quests from state
    log('Cleaning up expired quests...');
    let deletedCount = 0;
    for (const questId of Object.keys(state.quests)) {
        const questData = state.quests[questId];
        const expireTime = new Date(questData.expires_at);
        if (expireTime < now) {
            delete state.quests[questId];
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        log(`♻️ Cleaned up ${deletedCount} expired quest(s) from state.`);
        saveState(state);
    } else {
        log('🛑 No expired quests to clean up.');
    }

    state.last_check = new Date().toISOString();
    saveState(state);
    log('✨ Tracker completed successfully!');
}

// Run main
main().catch(async err => {
    error(err.message);
    await sendErrorNotice(err.stack ?? err.message);
    process.exit(1);
}); 

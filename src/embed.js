// ─── Embed Builder ────────────────────────────────────────────────────────
import { i18n } from './language.js';
import { formatDate, getReward, buildChangeDescription } from './utils.js';

const PING_ROLE_ID = process.env.PING_ROLE_ID;

/**
 * Build embed for NEW quest
 */
export async function buildNewQuestEmbed(content, quest, assets) {
    const config = quest.config;
    if (!config) return null;

    const questId = quest.id || '';
    const questLink = `https://canary.discord.com/quests/${questId}`;

    // Ping role hoặc fallback text
    let baseContent = content || `Nhiệm vụ mới: [${config.messages?.quest_name || i18n.error.new_quest}](${questLink})`;
    if (PING_ROLE_ID) {
        baseContent = `<@&${PING_ROLE_ID}> Nhiệm Vụ mới đã đến !!! [Click vào đây để làm nhiệm vụ](${questLink})`;
    }

    const durationStr = `${formatDate(config.starts_at)} - ${formatDate(config.expires_at)}`;
    const rewardDeadline = formatDate(config.rewards_config?.rewards_expire_at);

    const primaryReward = config.rewards_config?.rewards?.[0];
    const rewardName = primaryReward?.messages?.name || i18n.error.reward;
    const skuId = primaryReward?.sku_id || '';
    const rewards = getReward(primaryReward, rewardName);

    const questName = config.messages?.quest_name || i18n.error.new_quest;
    const gameTitle = config.messages?.game_title || i18n.error.game_name;
    const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;

    const applicationLink = config.application?.link || questLink || 'https://discord.com';
    const applicationName = config.application?.name || '';
    const applicationId = config.application?.id || '';
    const featureName = config.feature || '???';

    // Hero image hiển thị như hình 2
    const heroUrl = config.assets?.hero ? `https://cdn.discordapp.com/${config.assets.hero}` : assets.discordQuests;

    // Tasks
    const taskList = Object.values(config.task_config_v2?.tasks || {})
        .map(task => {
            const minutes = task.target ? task.target / 60 : 0;
            const taskName = task.type
                .toLowerCase()
                .replace(/_/g, ' ')
                .replace(/^\w/, c => c.toUpperCase());
            return `* ${taskName} (${minutes} phút)`;
        })
        .join('\n');

    const embed = {
        title: `### Nhiệm vụ mới - [${questName}](${questLink})`,
        image: { url: heroUrl }, // fix icon sang ảnh hero
        description: 
`-# *Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).*

## Thông tin nhiệm vụ
**Thời hạn**: ${durationStr}
**Hạn chót nhận thưởng**: ${rewardDeadline}
**Nền tảng nhận**: ${config.platform || '???'}
**Game**: ${gameTitle} (${gamePublisher})
**Application**: [${applicationName}](${applicationLink}) (\`${applicationId}\`)
**Tính năng**: ${featureName}

## Yêu cầu
Người dùng phải hoàn thành một trong các yêu cầu sau:
${taskList || '* ???'}

## Phần thưởng
**Loại phần thưởng**: ${rewards.rewardType}
**ID SKU**: \`${skuId}\`
**Phần thưởng**: ${rewardName}${rewards.extraReward}
${rewards.expires}
${primaryReward?.premium_orb_quantity ? `**Phần thưởng Nitro**: ${primaryReward.premium_orb_quantity}` : ''}

-# **ID Nhiệm vụ**: ${questId}`
    };

    return {
        username: i18n.name,
        avatar_url: assets.avatarWebhook,
        content: baseContent,
        embeds: [embed]
    };
}

/**
 * Build embed for UPDATED quest
 */
export async function buildUpdatedQuestEmbed(content, oldQuest, newQuest, assets, changes) {
    const config = newQuest.config;
    if (!config) return null;

    const questName = config.messages?.quest_name || i18n.error.new_quest;
    const questId = newQuest.id || '';
    const questLink = `https://canary.discord.com/quests/${questId}`;

    // Ping role hoặc fallback text
    let baseContent = content || `Nhiệm vụ đã cập nhật: [${questName}](${questLink})`;
    if (PING_ROLE_ID) {
        baseContent = `<@&${PING_ROLE_ID}> Nhiệm Vụ đã cập nhật !!! [Click vào đây để xem chi tiết](${questLink})`;
    }

    const heroUrl = config.assets?.hero ? `https://cdn.discordapp.com/${config.assets.hero}` : assets.discordQuests;

    // Detect thay đổi
    const changeDescription = buildChangeDescription(oldQuest, newQuest, changes);

    const embed = {
        title: `### Nhiệm vụ được cập nhật - [${questName}](${questLink})`,
        image: { url: heroUrl }, // fix icon sang ảnh hero
        description: 
`-# *Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).*

## Thay đổi
${changeDescription || 'Không có thay đổi'}

-# **ID Nhiệm vụ**: \`${questId}\``
    };

    return {
        username: i18n.name,
        avatar_url: assets.avatarWebhook,
        content: baseContent,
        embeds: [embed]
    };
}

// src/embed.js
import { i18n } from './language.js';
import { formatDate, getReward, buildChangeDescription } from './utils.js';

const PING_ROLE_ID = process.env.PING_ROLE_ID || '';

function extractPlatform(config) {
  if (!config) return '???';
  if (Array.isArray(config.platforms) && config.platforms.length) return config.platforms.join(', ');
  if (config.platform) return config.platform;
  if (config.platform_type) return config.platform_type;
  return 'Đa nền tảng';
}

function extractFeature(config) {
  if (!config) return '???';
  if (Array.isArray(config.features) && config.features.length) return config.features.join(', ');
  if (config.feature) return config.feature;
  if (Array.isArray(config.feature_flags) && config.feature_flags.length) return config.feature_flags.join(', ');
  return '???';
}

function buildTasksList(config) {
  const tasks = Object.values(config.task_config_v2?.tasks || {});
  if (!tasks.length) return '* ???';
  return tasks.map(task => {
    const minutes = task.target ? Math.round(task.target / 60) : 0;
    const type = String(task.type || '').toLowerCase().replace(/_/g, ' ');
    const name = type ? type.replace(/^\w/, c => c.toUpperCase()) : 'Task';
    return `* ${name} (${minutes} phút)`;
  }).join('\n');
}

/**
 * Build embed for NEW quest
 */
export async function buildNewQuestEmbed(content, quest, assets) {
  const config = quest?.config;
  if (!config) return null;

  const questId = quest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;

  let baseContent = content || `Nhiệm vụ mới: ${questName}`;
  if (PING_ROLE_ID) {
    baseContent = `<@&${PING_ROLE_ID}> Nhiệm Vụ mới đã đến !!! [Click vào đây để làm nhiệm vụ](${questLink})`;
  }

  const durationStr = `${formatDate(config.starts_at)} - ${formatDate(config.expires_at)}`;
  const rewardDeadline = formatDate(config.rewards_config?.rewards_expire_at) || '???';
  const platforms = extractPlatform(config);
  const features = extractFeature(config);

  const primaryReward = config.rewards_config?.rewards?.[0] || null;
  const rewardName = primaryReward?.messages?.name || i18n.error.reward;
  const skuId = primaryReward?.sku_id || '???';
  const rewards = getReward(primaryReward, rewardName);

  // Ảnh phần thưởng: lấy từ game_tile hoặc logotype
  const rewardImageUrl = config.assets?.game_tile
    ? `https://cdn.discordapp.com/${config.assets.game_tile}`
    : (config.assets?.logotype
        ? `https://cdn.discordapp.com/${config.assets.logotype}`
        : null);

  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationName = config.application?.name || '???';
  const applicationId = config.application?.id || '';

  const heroUrl = config.assets?.hero ? `https://cdn.discordapp.com/${config.assets.hero}` : assets.discordQuests;
  const taskList = buildTasksList(config);

  const descriptionLines = [
    `*Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).*`,
    '',
    `# **Thông tin nhiệm vụ**`,
    `**Thời hạn**: ${durationStr}`,
    `**Hạn chót nhận thưởng**: ${rewardDeadline}`,
    `**Nền tảng nhận**: ${platforms}`,
    `**Game**: ${gameTitle} (${gamePublisher})`,
    `**Application**: ${applicationName} (${applicationId})`,
    `**Tính năng**: ${features}`,
    '',
    `# **Yêu cầu**`,
    `Người dùng phải hoàn thành một trong các yêu cầu sau:`,
    `${taskList}`,
    '',
    `# **Phần thưởng**`,
    `**Loại phần thưởng**: ${rewards.rewardType}`,
    `**ID SKU**: \`${skuId}\``,
    `**Phần thưởng**: ${rewardName}${rewards.extraReward || ''}`,
    `${rewards.expires || ''}`,
    '',
    `**ID Nhiệm vụ**: ${questId}`
  ];

  const embedMain = {
    title: questName,
    image: { url: heroUrl },
    description: descriptionLines.join('\n'),
    footer: { text: `New Quest !!! - Được làm bởi Kanamoto Kumo` }
  };

  const embeds = [embedMain];

  if (rewardImageUrl) {
    embeds.push({
      description: `**Ảnh phần thưởng**`,
      image: { url: rewardImageUrl }
    });
  }

  // Video nhiệm vụ: lấy từ hero_video, quest_bar_hero_video hoặc task.assets.video
  let videoUrl = null;
  if (config.assets?.hero_video) {
    videoUrl = `https://cdn.discordapp.com/${config.assets.hero_video}`;
  } else if (config.assets?.quest_bar_hero_video) {
    videoUrl = `https://cdn.discordapp.com/${config.assets.quest_bar_hero_video}`;
  } else {
    for (const task of Object.values(config.task_config_v2?.tasks || {})) {
      if (task.type?.toUpperCase().includes('WATCH_VIDEO') && task.assets?.video?.url) {
        videoUrl = task.assets.video.url;
        break;
      }
    }
  }
  if (videoUrl) {
    embeds.push({
      description: `**Video nhiệm vụ**`,
      image: { url: videoUrl }
    });
  }

  return {
    username: i18n.name,
    avatar_url: assets.avatarWebhook,
    content: baseContent,
    embeds
  };
}

/**
 * Build embed for UPDATED quest
 */
export async function buildUpdatedQuestEmbed(content, oldQuest, newQuest, assets, changes) {
  const config = newQuest?.config;
  if (!config) return null;

  const questId = newQuest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;

  let baseContent = content || `Nhiệm vụ đã cập nhật: ${questName}`;
  if (PING_ROLE_ID) {
    baseContent = `<@&${PING_ROLE_ID}> Nhiệm Vụ đã cập nhật !!! [Click vào đây để xem chi tiết](${questLink})`;
  }

  const heroUrl = config.assets?.hero ? `https://cdn.discordapp.com/${config.assets.hero}` : assets.discordQuests;
  const changeDescription = buildChangeDescription(oldQuest, newQuest, changes) || 'Không có thay đổi';

  const descriptionLines = [
    `*Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).*`,
    '',
    `# **Thay đổi**`,
    `${changeDescription}`,
    '',
    `**ID Nhiệm vụ**: \`${questId}\``
  ];

  const embed = {
    title: questName,
    image: { url: heroUrl },
    description: descriptionLines.join('\n'),
    footer: { text: `Quest Update !!! - Được làm bởi Kanamoto Kumo` }
  };

  return {
    username: i18n.name,
    avatar_url: assets.avatarWebhook,
    content: baseContent,
    embeds: [embed]
  };
}

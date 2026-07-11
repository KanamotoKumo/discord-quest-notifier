// src/embed.js
import { i18n } from './language.js';
import { formatDate, getReward, buildChangeDescription } from './utils.js';

const PING_ROLE_ID = process.env.PING_ROLE_ID || '';

/* Helpers */
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

/* Resolve reward image from config.assets (game_tile, logotype, etc.) */
function resolveRewardImage(config, assetsFallback) {
  if (!config) return null;
  const a = config.assets || {};
  const candidates = [
    a.game_tile,
    a.game_tile_light,
    a.game_tile_dark,
    a.logotype,
    a.logotype_light,
    a.logotype_dark,
    assetsFallback?.discordQuests
  ];
  const found = candidates.find(x => !!x);
  return found ? `https://cdn.discordapp.com/${found}` : null;
}

/* Resolve video url (hero_video, quest_bar_hero_video, or task.assets.video) */
function resolveVideoUrl(config) {
  if (!config) return null;
  if (config.assets?.hero_video) return `https://cdn.discordapp.com/${config.assets.hero_video}`;
  if (config.assets?.quest_bar_hero_video) return `https://cdn.discordapp.com/${config.assets.quest_bar_hero_video}`;

  const tasks = Object.values(config.task_config_v2?.tasks || {});
  for (const task of tasks) {
    const t = String(task.type || '').toUpperCase();
    if (t.includes('WATCH_VIDEO')) {
      if (task.assets?.video?.url) return task.assets.video.url;
      if (task.assets?.video_low_res?.url) return task.assets.video_low_res.url;
      if (task.assets?.video_hls?.url) return task.assets.video_hls.url;
    }
  }
  return null;
}

/* Build single embed for NEW quest
   - hero image as embed.image (large)
   - reward icon as embed.thumbnail (circular)
   - if video exists: include a watch link field (Discord may auto-preview MP4)
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

  const heroUrl = config.assets?.hero ? `https://cdn.discordapp.com/${config.assets.hero}` : assets.discordQuests;
  const rewardImageUrl = resolveRewardImage(config, assets);
  const videoUrl = resolveVideoUrl(config);

  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationName = config.application?.name || '???';
  const applicationId = config.application?.id || '';

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
    `${rewards.expires || ''}`
  ];

  if (videoUrl) {
    // add clear watch link; Discord will often show a playable preview for MP4
    descriptionLines.push('', `**Video nhiệm vụ**: [▶️ Xem video nhiệm vụ](${videoUrl})`);
  }

  descriptionLines.push('', `**ID Nhiệm vụ**: ${questId}`);

  const embed = {
    title: questName,
    description: descriptionLines.join('\n'),
    thumbnail: rewardImageUrl ? { url: rewardImageUrl } : undefined, // circular icon
    image: heroUrl ? { url: heroUrl } : undefined, // large hero rectangle
    footer: { text: `New Quest Appeared !!! - Được làm bởi Korchi Community` }
  };

  return {
    username: i18n.name,
    avatar_url: assets.avatarWebhook,
    content: baseContent,
    embeds: [embed]
  };
}

/* Build single embed for UPDATED quest
   Signature matches main.js: (content, oldQuest, newQuest, assets, changes)
   Uses buildChangeDescription to list only changed fields.
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
  const rewardImageUrl = resolveRewardImage(config, assets);
  const videoUrl = resolveVideoUrl(config);

  const changeDescription = buildChangeDescription(oldQuest, newQuest, changes) || 'Không có thay đổi';

  const descriptionLines = [
    `*Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).*`,
    '',
    `**Thay đổi**`,
    `${changeDescription}`,
    ''
  ];

  if (videoUrl) {
    descriptionLines.push(`**Video nhiệm vụ**: [▶️ Xem video nhiệm vụ](${videoUrl})`, '');
  }

  descriptionLines.push(`**ID Nhiệm vụ**: \`${questId}\``);

  const embed = {
    title: questName,
    description: descriptionLines.join('\n'),
    thumbnail: rewardImageUrl ? { url: rewardImageUrl } : undefined,
    image: heroUrl ? { url: heroUrl } : undefined,
    footer: { text: `Update Quest !!! - Được làm bởi Korchi Community` }
  };

  return {
    username: i18n.name,
    avatar_url: assets.avatarWebhook,
    content: baseContent,
    embeds: [embed]
  };
}

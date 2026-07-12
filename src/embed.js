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

/* Resolve asset paths inside config.assets */
function resolveRewardImagePath(config) {
  const a = config.assets || {};
  return a.game_tile || a.game_tile_light || a.game_tile_dark || a.logotype || a.logotype_light || a.logotype_dark || null;
}
function resolveHeroPath(config) {
  return config.assets?.hero || null;
}
function resolveHeroVideoPath(config) {
  return config.assets?.hero_video || config.assets?.quest_bar_hero_video || null;
}

/* Build attachments array from relative asset paths
   Each attachment: { url, filename, contentType }
*/
function buildAttachmentsFromConfig(config, assetsFallback, questId) {
  const attachments = [];
  const heroPath = resolveHeroPath(config);
  const rewardPath = resolveRewardImagePath(config);
  const heroVideoPath = resolveHeroVideoPath(config);

  if (heroPath) {
    const ext = heroPath.slice(heroPath.lastIndexOf('.')) || '.png';
    attachments.push({
      url: `https://cdn.discordapp.com/${heroPath}`,
      filename: `hero_${questId}${ext}`,
      contentType: 'image/*'
    });
  } else if (assetsFallback?.discordQuests) {
    attachments.push({
      url: assetsFallback.discordQuests,
      filename: `hero_fallback_${questId}.png`,
      contentType: 'image/*'
    });
  }

  if (rewardPath) {
    const ext = rewardPath.slice(rewardPath.lastIndexOf('.')) || '.png';
    attachments.push({
      url: `https://cdn.discordapp.com/${rewardPath}`,
      filename: `reward_${questId}${ext}`,
      contentType: 'image/*'
    });
  }

  if (heroVideoPath) {
    const ext = heroVideoPath.slice(heroVideoPath.lastIndexOf('.')) || '.mp4';
    attachments.push({
      url: `https://cdn.discordapp.com/${heroVideoPath}`,
      filename: `video_${questId}${ext}`,
      contentType: 'video/mp4'
    });
  }

  return attachments;
}

/**
 * Build payload + attachments for new quest
 * returns { payload, attachments }
 * Single embed only: hero -> image, reward -> thumbnail, video -> embed.video (if possible) + button
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
  const primaryReward = config.rewards_config?.rewards?.[0] || null;
  const rewardName = primaryReward?.messages?.name || i18n.error.reward;
  const skuId = primaryReward?.sku_id || '???';
  const rewards = getReward(primaryReward, rewardName);

  // Build attachments list
  const attachments = buildAttachmentsFromConfig(config, assets, questId);

  // Determine attachment references for embed (attachment://filename) or fallback remote URL
  const heroAttachment = attachments.find(a => a.filename && a.filename.startsWith(`hero_${questId}`)) || attachments.find(a => a.filename && a.filename.startsWith(`hero_fallback_${questId}`));
  const rewardAttachment = attachments.find(a => a.filename && a.filename.startsWith(`reward_${questId}`));
  const videoAttachment = attachments.find(a => a.filename && a.filename.startsWith(`video_${questId}`));

  const heroImageRef = heroAttachment ? `attachment://${heroAttachment.filename}` : (assets.discordQuests || null);
  const rewardImageRef = rewardAttachment ? `attachment://${rewardAttachment.filename}` : null;
  const videoAttachmentRef = videoAttachment ? `attachment://${videoAttachment.filename}` : null;
  const videoFallbackUrl = resolveHeroVideoPath(config) ? `https://cdn.discordapp.com/${resolveHeroVideoPath(config)}` : null;
  const videoRef = videoAttachmentRef || videoFallbackUrl || null;

  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationName = config.application?.name || '???';
  const applicationId = config.application?.id || '';

  const platforms = extractPlatform(config);
  const features = extractFeature(config);
  const taskList = buildTasksList(config);

  const descriptionLines = [
    `*Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v.*`,
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

  // Note: removed inline video link from description to avoid duplication
  descriptionLines.push('', `**ID Nhiệm vụ**: ${questId}`);

  // Single embed: hero image + thumbnail reward + (attempt) embed.video
  const embed = {
    title: questName,
    description: descriptionLines.join('\n'),
    thumbnail: rewardImageRef ? { url: rewardImageRef } : undefined,
    image: heroImageRef ? { url: heroImageRef } : undefined,
    footer: { text: `New Quest Appeared !!! - Được làm bởi Korchi Community` }
  };

  // Try to set embed.video if we have an attachment reference (Discord may ignore if not supported)
  if (videoAttachmentRef) {
    embed.video = { url: videoAttachmentRef };
  }

  // Components (buttons) — keep single action row with relevant links
  const components = [];
  const actionRow = { type: 1, components: [] };

  actionRow.components.push({
    type: 2,
    style: 5,
    label: 'Mở nhiệm vụ',
    url: questLink
  });

  if (videoRef) {
    const videoButtonUrl = videoFallbackUrl || (videoAttachment ? videoAttachment.url : null);
    if (videoButtonUrl) {
      actionRow.components.push({
        type: 2,
        style: 5,
        label: 'Xem video',
        url: videoButtonUrl
      });
    }
  }

  if (rewardAttachment) {
    const rewardUrlFallback = rewardAttachment ? `https://cdn.discordapp.com/${resolveRewardImagePath(config)}` : (assets.discordQuests || '');
    if (rewardUrlFallback) {
      actionRow.components.push({
        type: 2,
        style: 5,
        label: 'Ảnh phần thưởng',
        url: rewardUrlFallback
      });
    }
  }

  if (actionRow.components.length) components.push(actionRow);

  const payload = {
    content: baseContent,
    embeds: [embed],
    components
  };

  return { payload, attachments };
}

/**
 * Build payload + attachments for updated quest (single embed)
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

  const attachments = buildAttachmentsFromConfig(config, assets, questId);

  const heroAttachment = attachments.find(a => a.filename && a.filename.startsWith(`hero_${questId}`)) || attachments.find(a => a.filename && a.filename.startsWith(`hero_fallback_${questId}`));
  const rewardAttachment = attachments.find(a => a.filename && a.filename.startsWith(`reward_${questId}`));
  const videoAttachment = attachments.find(a => a.filename && a.filename.startsWith(`video_${questId}`));

  const heroImageRef = heroAttachment ? `attachment://${heroAttachment.filename}` : (assets.discordQuests || null);
  const rewardImageRef = rewardAttachment ? `attachment://${rewardAttachment.filename}` : null;
  const videoAttachmentRef = videoAttachment ? `attachment://${videoAttachment.filename}` : null;
  const videoFallbackUrl = resolveHeroVideoPath(config) ? `https://cdn.discordapp.com/${resolveHeroVideoPath(config)}` : null;
  const videoRef = videoAttachmentRef || videoFallbackUrl || null;

  const changeDescription = buildChangeDescription(oldQuest, newQuest, changes) || 'Không có thay đổi';

  const descriptionLines = [
    `*Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng.*`,
    '',
    `# **Thay đổi**`,
    `${changeDescription}`,
    ''
  ];

  // Note: removed inline video link from description to avoid duplication
  descriptionLines.push(`**ID Nhiệm vụ**: \`${questId}\``);

  const embed = {
    title: questName,
    description: descriptionLines.join('\n'),
    thumbnail: rewardImageRef ? { url: rewardImageRef } : undefined,
    image: heroImageRef ? { url: heroImageRef } : undefined,
    footer: { text: `Updated Quest !!! - Được làm bởi Korchi Community` }
  };

  if (videoAttachmentRef) {
    embed.video = { url: videoAttachmentRef };
  }

  const components = [];
  const actionRow = { type: 1, components: [] };

  actionRow.components.push({
    type: 2,
    style: 5,
    label: 'Mở nhiệm vụ',
    url: questLink
  });

  if (videoRef) {
    const videoButtonUrl = videoFallbackUrl || (videoAttachment ? videoAttachment.url : null);
    if (videoButtonUrl) {
      actionRow.components.push({
        type: 2,
        style: 5,
        label: 'Xem video',
        url: videoButtonUrl
      });
    }
  }

  if (rewardAttachment) {
    const rewardUrlFallback = rewardAttachment ? `https://cdn.discordapp.com/${resolveRewardImagePath(config)}` : (assets.discordQuests || '');
    if (rewardUrlFallback) {
      actionRow.components.push({
        type: 2,
        style: 5,
        label: 'Ảnh phần thưởng',
        url: rewardUrlFallback
      });
    }
  }

  if (actionRow.components.length) components.push(actionRow);

  const payload = {
    content: baseContent,
    embeds: [embed],
    components
  };

  return { payload, attachments };
}

// src/embed.js
// ─── Embed Builder v2 (always use v2 components; optional legacy flag only toggles flags field)
// - Reads state.json to resolve placeholder assets
// - Embeds hero image, reward image, and hero video directly into the embed via attachment://filename when available
// - Returns { payload, attachments } where attachments is array of { url, filename, contentType, sourcePath }
import fs from 'fs/promises';
import path from 'path';
import { i18n } from './language.js';
import { formatDate, getReward, buildChangeDescription } from './utils.js';

const PING_ROLE_ID = process.env.PING_ROLE_ID || '';
// If true, include legacy flags field (keeps embed array but UI is v2 components). Default false.
const INCLUDE_LEGACY_FLAG = (process.env.INCLUDE_LEGACY_FLAG || 'false').toLowerCase() === 'true';

/**
 * Read state.json safely (used to resolve placeholder asset paths)
 */
async function readStateFile() {
  try {
    const p = path.resolve(process.cwd(), 'state.json');
    const raw = await fs.readFile(p, 'utf8').catch(() => null);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

/**
 * Build CDN URL from relative asset path or return absolute URL as-is
 */
function buildCdnUrl(assetPath) {
  if (!assetPath) return null;
  const s = String(assetPath).trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  const normalized = s.replace(/^\/+/, '');
  return `https://cdn.discordapp.com/${normalized}`;
}

/**
 * Resolve an asset value (may be placeholder) using state.json fallback for the same questId
 * Returns normalized asset path string or null
 */
async function resolveAssetPath(assetValue, questId) {
  if (!assetValue) return null;
  const trimmed = String(assetValue).trim();
  if (!trimmed) return null;

  // If placeholder-like, try to resolve from state.json
  if (/PLACEHOLDER/i.test(trimmed) || trimmed.toLowerCase() === 'placeholder') {
    try {
      const state = await readStateFile();
      const prev = state?.quests?.[questId];
      const prevConfig = prev?.config || {};
      const prevAssets = prevConfig.assets || {};
      const candidates = [
        prevAssets.hero,
        prevAssets.hero_video,
        prevAssets.quest_bar_hero,
        prevAssets.quest_bar_hero_video,
        prevAssets.game_tile,
        prevAssets.game_tile_light,
        prevAssets.game_tile_dark,
        prevAssets.logotype,
        prevAssets.logotype_light,
        prevAssets.logotype_dark
      ];
      for (const c of candidates) {
        if (c && !/PLACEHOLDER/i.test(String(c))) return String(c).trim();
      }
    } catch (e) {
      // ignore and return null
    }
    return null;
  }

  return trimmed;
}

/**
 * Build attachments list from config.
 * Returns { attachments, heroAttachment, rewardAttachment, videoAttachment }
 * Each attachment: { url, filename, contentType, sourcePath }
 */
async function buildAttachmentsFromConfig(config, assetsFallback, questId) {
  const attachments = [];

  const heroRaw = config?.assets?.hero || config?.assets?.quest_bar_hero || null;
  const heroVideoRaw = config?.assets?.hero_video || config?.assets?.quest_bar_hero_video || null;
  const rewardRaw = config?.assets?.game_tile || config?.assets?.game_tile_light || config?.assets?.game_tile_dark || config?.assets?.logotype || config?.assets?.logotype_light || config?.assets?.logotype_dark || null;

  const heroPath = await resolveAssetPath(heroRaw, questId);
  const heroVideoPath = await resolveAssetPath(heroVideoRaw, questId);
  const rewardPath = await resolveAssetPath(rewardRaw, questId);

  function push(assetPath, prefix) {
    if (!assetPath) return null;
    const url = buildCdnUrl(assetPath);
    if (!url) return null;
    const ext = path.extname(assetPath) || '';
    const safeExt = ext || (/\.(mp4|webm)$/i.test(assetPath) ? '.mp4' : '.png');
    const filename = `${prefix}_${questId}${safeExt}`;
    const contentType = /\.(mp4|webm)$/i.test(safeExt) ? 'video/mp4' : 'image/*';
    const entry = { url, filename, contentType, sourcePath: assetPath };
    attachments.push(entry);
    return entry;
  }

  const heroAttachment = push(heroPath, 'hero') || (assetsFallback?.discordQuests ? { url: assetsFallback.discordQuests, filename: `hero_fallback_${questId}.png`, contentType: 'image/*', sourcePath: assetsFallback.discordQuests } : null);
  const rewardAttachment = push(rewardPath, 'reward') || null;
  const videoAttachment = push(heroVideoPath, 'video') || null;

  return { attachments, heroAttachment, rewardAttachment, videoAttachment };
}

/**
 * Build embed payload + attachments for new quest
 * Always uses v2 components; includes images/videos directly in embed via attachment:// when available
 */
export async function buildNewQuestEmbed(content, quest, assets) {
  const config = quest?.config;
  if (!config) return null;

  const questId = quest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;

  let baseContent = content || `Nhiệm vụ mới: ${questName}`;
  if (PING_ROLE_ID) {
    baseContent = `<@&${PING_ROLE_ID}> ${i18n.new_quest_mention || 'Nhiệm Vụ mới đã đến'} — ${i18n.open_quest || 'Mở nhiệm vụ'}: ${questLink}`;
  }

  const durationStr = `${formatDate(config.starts_at)} - ${formatDate(config.expires_at)}`;
  const rewardDeadline = formatDate(config.rewards_config?.rewards_expire_at) || '—';
  const primaryReward = config.rewards_config?.rewards?.[0] || null;
  const rewardName = primaryReward?.messages?.name || i18n.error.reward;
  const skuId = primaryReward?.sku_id || '—';
  const rewards = getReward(primaryReward, rewardName);

  const { attachments, heroAttachment, rewardAttachment, videoAttachment } = await buildAttachmentsFromConfig(config, assets, questId);

  // Build embed references (prefer attachment://)
  const heroRef = heroAttachment ? `attachment://${heroAttachment.filename}` : (assets.discordQuests || null);
  const rewardRef = rewardAttachment ? `attachment://${rewardAttachment.filename}` : null;
  const videoRef = videoAttachment ? `attachment://${videoAttachment.filename}` : (heroAttachment?.sourcePath ? buildCdnUrl(heroAttachment.sourcePath) : null);

  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationName = config.application?.name || '—';
  const applicationId = config.application?.id || '—';

  const platforms = Array.isArray(config.platforms) && config.platforms.length ? config.platforms.join(', ') : (config.platform || config.platform_type || 'Đa nền tảng');
  const features = Array.isArray(config.features) && config.features.length ? config.features.join(', ') : (config.feature || config.feature_flags || '—');

  const tasks = Object.values(config.task_config_v2?.tasks || {});
  const tasksText = tasks.length ? tasks.map(t => {
    const minutes = t.target ? Math.round(t.target / 60) : 0;
    const type = String(t.type || '').toLowerCase().replace(/_/g, ' ');
    const name = type ? type.replace(/^\w/, c => c.toUpperCase()) : 'Task';
    return `• ${name} (${minutes} phút)`;
  }).join('\n') : '* —';

  const description = [
    `*${i18n.note_restart_app || 'Nếu không thấy nhiệm vụ trong app, thử khởi động lại ứng dụng.'}*`,
    '',
    `**${i18n.quest_info || 'Thông tin nhiệm vụ'}**`,
    `**${i18n.duration || 'Thời hạn'}**: ${durationStr}`,
    `**${i18n.reward_deadline || 'Hạn chót nhận thưởng'}**: ${rewardDeadline}`,
    `**${i18n.platforms || 'Nền tảng'}**: ${platforms}`,
    `**${i18n.game || 'Game'}**: ${gameTitle} (${gamePublisher})`,
    `**${i18n.application || 'Application'}**: ${applicationName} (${applicationId})`,
    `**${i18n.features || 'Tính năng'}**: ${features}`,
    '',
    `**${i18n.requirements || 'Yêu cầu'}**`,
    tasksText,
    '',
    `**${i18n.rewards || 'Phần thưởng'}**`,
    `**${i18n.reward_type || 'Loại'}**: ${rewards.rewardType}`,
    `**${i18n.sku || 'SKU'}**: \`${skuId}\``,
    `**${i18n.reward_name || 'Phần thưởng'}**: ${rewardName}${rewards.extraReward || ''}`,
    `${rewards.expires || ''}`,
    '',
    `**${i18n.quest_id || 'ID Nhiệm vụ'}**: \`${questId}\``
  ].join('\n');

  const embed = {
    title: questName,
    description,
    color: 0x2f3136,
    footer: { text: `${i18n.quest_id || 'ID'}: ${questId}` }
  };

  if (heroRef) embed.image = { url: heroRef };
  if (rewardRef) embed.thumbnail = { url: rewardRef };
  // embed.video may be ignored by Discord for webhooks, but include if available
  if (videoRef) embed.video = { url: videoRef };

  // Components v2 (action row with buttons)
  const components = [];
  const actionRow = { type: 1, components: [] };

  actionRow.components.push({
    type: 2,
    style: 5,
    label: i18n.open_quest_button || 'Mở nhiệm vụ',
    url: questLink
  });

  const videoButtonUrl = videoAttachment ? videoAttachment.url : (videoRef || null);
  if (videoButtonUrl) {
    actionRow.components.push({
      type: 2,
      style: 5,
      label: i18n.view_video_button || 'Xem video',
      url: videoButtonUrl
    });
  }

  const rewardButtonUrl = rewardAttachment ? rewardAttachment.url : (assets.discordQuests || null);
  if (rewardButtonUrl) {
    actionRow.components.push({
      type: 2,
      style: 5,
      label: i18n.view_reward_button || 'Ảnh phần thưởng',
      url: rewardButtonUrl
    });
  }

  if (actionRow.components.length) components.push(actionRow);

  const payload = {
    content: baseContent,
    embeds: [embed],
    components
  };

  // Optionally include legacy flags field if requested (keeps embed array but doesn't change components)
  if (INCLUDE_LEGACY_FLAG) {
    payload.flags = 1 << 15;
  }

  return { payload, attachments };
}

/**
 * Build embed payload + attachments for updated quest
 */
export async function buildUpdatedQuestEmbed(content, oldQuest, newQuest, assets, changes) {
  const config = newQuest?.config;
  if (!config) return null;

  const questId = newQuest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;

  let baseContent = content || `Nhiệm vụ đã cập nhật: ${questName}`;
  if (PING_ROLE_ID) {
    baseContent = `<@&${PING_ROLE_ID}> ${i18n.updated_quest_mention || 'Nhiệm Vụ đã cập nhật'} — ${i18n.open_quest || 'Xem chi tiết'}: ${questLink}`;
  }

  const { attachments, heroAttachment, rewardAttachment, videoAttachment } = await buildAttachmentsFromConfig(config, assets, questId);

  const heroRef = heroAttachment ? `attachment://${heroAttachment.filename}` : (assets.discordQuests || null);
  const rewardRef = rewardAttachment ? `attachment://${rewardAttachment.filename}` : null;
  const videoRef = videoAttachment ? `attachment://${videoAttachment.filename}` : (heroAttachment?.sourcePath ? buildCdnUrl(heroAttachment.sourcePath) : null);

  const changeDescription = buildChangeDescription(oldQuest, newQuest, changes) || (i18n.no_changes || 'Không có thay đổi');

  const description = [
    `*${i18n.note_restart_app || 'Nếu không thấy nhiệm vụ trong app, thử khởi động lại ứng dụng.'}*`,
    '',
    `**${i18n.changes || 'Thay đổi'}**`,
    changeDescription,
    '',
    `**${i18n.quest_id || 'ID Nhiệm vụ'}**: \`${questId}\``
  ].join('\n');

  const embed = {
    title: questName,
    description,
    color: 0xffcc00,
    footer: { text: `${i18n.quest_id || 'ID'}: ${questId}` }
  };

  if (heroRef) embed.image = { url: heroRef };
  if (rewardRef) embed.thumbnail = { url: rewardRef };
  if (videoRef) embed.video = { url: videoRef };

  const components = [];
  const actionRow = { type: 1, components: [] };

  actionRow.components.push({
    type: 2,
    style: 5,
    label: i18n.open_quest_button || 'Mở nhiệm vụ',
    url: questLink
  });

  const videoButtonUrl = videoAttachment ? videoAttachment.url : (videoRef || null);
  if (videoButtonUrl) {
    actionRow.components.push({
      type: 2,
      style: 5,
      label: i18n.view_video_button || 'Xem video',
      url: videoButtonUrl
    });
  }

  const rewardButtonUrl = rewardAttachment ? rewardAttachment.url : (assets.discordQuests || null);
  if (rewardButtonUrl) {
    actionRow.components.push({
      type: 2,
      style: 5,
      label: i18n.view_reward_button || 'Ảnh phần thưởng',
      url: rewardButtonUrl
    });
  }

  if (actionRow.components.length) components.push(actionRow);

  const payload = {
    content: baseContent,
    embeds: [embed],
    components
  };

  if (INCLUDE_LEGACY_FLAG) {
    payload.flags = 1 << 15;
  }

  return { payload, attachments };
}

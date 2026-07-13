// src/embed.js
// ─── Embed Builder v2 (Discord Components V2 — actually compliant this time)
//
// What changed vs the previous version:
// - Discord's IS_COMPONENTS_V2 flag (1 << 15) disables `content` and `embeds` entirely —
//   you cannot send both. The old code always built a classic `embed` object (image/
//   thumbnail/video/description) and only conditionally added the V2 flag, which meant
//   enabling that flag would have made Discord reject the payload (400 Bad Request).
//   By default the flag was off, so the bot was actually sending plain legacy embeds,
//   not V2 components, despite the file's comments.
// - `embed.video` was never valid for bot/webhook-created embeds anyway — Discord only
//   populates that field itself when unfurling a link (e.g. YouTube). It was silently
//   ignored.
// - Images are now referenced by their original Discord CDN URL directly inside
//   Media Gallery / Thumbnail components, instead of being downloaded and re-uploaded
//   as attachments. This also removes the whole download step that was causing the
//   "Failed to fetch attachment ... 403" errors — Discord's CDN increasingly rejects
//   programmatic downloads from automated/cloud origins (confirmed for e.g. Cloudflare
//   Workers), but has no problem resolving the same URL itself when rendering the
//   message. Net result: no more attachments to build, so `attachments` is now always [].
//
// IMPORTANT — if you're sending this through a webhook URL, Discord ignores components
// unless the request includes the query param `?with_components=true` on the webhook
// URL. This is separate from the IS_COMPONENTS_V2 flag and easy to miss.
//
// - Reads state.json to resolve placeholder assets (unchanged from before)
import fs from 'fs/promises';
import path from 'path';
import { i18n } from './language.js';
import { formatDate, getReward, buildChangeDescription } from './utils.js';

const PING_ROLE_ID = process.env.PING_ROLE_ID || '';
const IS_COMPONENTS_V2 = 1 << 15; // 32768

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
 * Build CDN URL from a relative asset path, or return an absolute URL as-is.
 * No fetching happens here — this just produces the string Discord will resolve
 * itself when it renders the message.
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
 * Resolve an asset value (may be a PLACEHOLDER) using state.json fallback for the same questId
 */
async function resolveAssetPath(assetValue, questId) {
  if (!assetValue) return null;
  const trimmed = String(assetValue).trim();
  if (!trimmed) return null;

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
        prevAssets.logotype_dark,
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
 * Resolve hero / reward / video image URLs directly from config.
 * Nothing is downloaded — these are just the URLs Media Gallery / Thumbnail
 * components will point at.
 */
async function resolveAssetUrls(config, assetsFallback, questId) {
  const heroRaw = config?.assets?.hero || config?.assets?.quest_bar_hero || null;
  const heroVideoRaw = config?.assets?.hero_video || config?.assets?.quest_bar_hero_video || null;
  const rewardRaw =
    config?.assets?.game_tile ||
    config?.assets?.game_tile_light ||
    config?.assets?.game_tile_dark ||
    config?.assets?.logotype ||
    config?.assets?.logotype_light ||
    config?.assets?.logotype_dark ||
    null;

  const heroPath = await resolveAssetPath(heroRaw, questId);
  const heroVideoPath = await resolveAssetPath(heroVideoRaw, questId);
  const rewardPath = await resolveAssetPath(rewardRaw, questId);

  const heroUrl = buildCdnUrl(heroPath) || assetsFallback?.discordQuests || null;
  const videoUrl = buildCdnUrl(heroVideoPath);
  const rewardUrl = buildCdnUrl(rewardPath);

  return { heroUrl, videoUrl, rewardUrl };
}

// ─── Small V2 component builders ───────────────────────────────────────────

function textDisplay(content) {
  return { type: 10, content };
}

function separator(divider = true, spacing = 1) {
  return { type: 14, divider, spacing };
}

function mediaGallery(heroUrl, videoUrl, altText) {
  const items = [];
  if (heroUrl) items.push({ media: { url: heroUrl }, description: altText });
  if (videoUrl) items.push({ media: { url: videoUrl }, description: `${altText} - video` });
  return items.length ? { type: 12, items } : null;
}

function sectionOrText(bodyText, rewardUrl) {
  if (rewardUrl) {
    return {
      type: 9,
      components: [textDisplay(bodyText)],
      accessory: { type: 11, media: { url: rewardUrl } },
    };
  }
  return textDisplay(bodyText);
}

function linkButtonRow({ questLink, videoUrl, rewardUrl, openLabel, videoLabel, rewardLabel }) {
  const buttons = [{ type: 2, style: 5, label: openLabel, url: questLink }];
  if (videoUrl) buttons.push({ type: 2, style: 5, label: videoLabel, url: videoUrl });
  if (rewardUrl) buttons.push({ type: 2, style: 5, label: rewardLabel, url: rewardUrl });
  return { type: 1, components: buttons };
}

/**
 * Build the "quest info" text block (duration, platforms, game, etc.)
 */
function buildInfoText(config) {
  const durationStr = `${formatDate(config.starts_at)} - ${formatDate(config.expires_at)}`;
  const rewardDeadline = formatDate(config.rewards_config?.rewards_expire_at) || '—';
  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationName = config.application?.name || '—';
  const applicationId = config.application?.id || '—';
  const platforms =
    Array.isArray(config.platforms) && config.platforms.length
      ? config.platforms.join(', ')
      : config.platform || config.platform_type || 'Đa nền tảng';
  const features =
    Array.isArray(config.features) && config.features.length
      ? config.features.join(', ')
      : config.feature || config.feature_flags || '—';

  return [
    `# **${i18n.quest_info || 'Thông tin nhiệm vụ'}**`,
    `**${i18n.duration || 'Thời hạn'}**: ${durationStr}`,
    `**${i18n.reward_deadline || 'Hạn chót nhận thưởng'}**: ${rewardDeadline}`,
    `**${i18n.platforms || 'Nền tảng'}**: ${platforms}`,
    `**${i18n.game || 'Game'}**: ${gameTitle} (${gamePublisher})`,
    `**${i18n.application || 'Application'}**: ${applicationName} (${applicationId})`,
    `**${i18n.features || 'Tính năng'}**: ${features}`,
  ].join('\n');
}

function buildTasksText(config) {
  const tasks = Object.values(config.task_config_v2?.tasks || {});
  if (!tasks.length) return '—';
  return tasks
    .map(t => {
      const minutes = t.target ? Math.round(t.target / 60) : 0;
      const type = String(t.type || '').toLowerCase().replace(/_/g, ' ');
      const name = type ? type.replace(/^\w/, c => c.toUpperCase()) : 'Task';
      return `• ${name} (${minutes} phút)`;
    })
    .join('\n');
}

function buildRewardsText({ rewards, skuId, rewardName }) {
  return [
    `# **${i18n.rewards || 'Phần thưởng'}**`,
    `**${i18n.reward_type || 'Loại'}**: ${rewards.rewardType}`,
    `**${i18n.sku || 'SKU'}**: \`${skuId}\``,
    `**${i18n.reward_name || 'Phần thưởng'}**: ${rewardName}${rewards.extraReward || ''}`,
    `${rewards.expires || ''}`,
  ].join('\n');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build embed payload for a new quest.
 * Returns { payload, attachments }. `attachments` is always [] now — nothing
 * needs to be downloaded or re-uploaded, images are linked directly.
 */
export async function buildNewQuestEmbed(content, quest, assets) {
  const config = quest?.config;
  if (!config) return null;

  const questId = quest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;
  const restartNote = i18n.note_restart_app || '-# *Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).*';

  const { heroUrl, videoUrl, rewardUrl } = await resolveAssetUrls(config, assets, questId);

  const primaryReward = config.rewards_config?.rewards?.[0] || null;
  const rewardName = primaryReward?.messages?.name || i18n.error.reward;
  const skuId = primaryReward?.sku_id || '—';
  const rewards = getReward(primaryReward, rewardName);

  const headerLines = [];
  if (PING_ROLE_ID) {
    headerLines.push(
      `<@&${PING_ROLE_ID}> ${i18n.new_quest_mention || 'Nhiệm Vụ mới đã đến !!!'} — [${i18n.open_quest || 'Mở nhiệm vụ tại đây'}](${questLink})`
    );
  } else if (content) {
    headerLines.push(content);
  }
  headerLines.push(`# ${questName}`);
  headerLines.push(`*${restartNote}*`);

  const infoText = buildInfoText(config);
  const requirementsText = [`# **${i18n.requirements || 'Yêu cầu'}**`, buildTasksText(config)].join('\n');
  const rewardsText = buildRewardsText({ rewards, skuId, rewardName });
  const footerText = `**${i18n.quest_id || 'ID Nhiệm vụ'}**: \`${questId}\``;

  const containerChildren = [textDisplay(headerLines.join('\n'))];

  const gallery = mediaGallery(heroUrl, videoUrl, questName);
  if (gallery) containerChildren.push(gallery);

  containerChildren.push(separator());
  containerChildren.push(sectionOrText(infoText, rewardUrl));
  containerChildren.push(separator());
  containerChildren.push(textDisplay(requirementsText));
  containerChildren.push(separator());
  containerChildren.push(textDisplay(rewardsText));
  containerChildren.push(textDisplay(footerText));
  containerChildren.push(separator());
  containerChildren.push(
    linkButtonRow({
      questLink,
      videoUrl,
      rewardUrl,
      openLabel: i18n.open_quest_button || 'Mở nhiệm vụ',
      videoLabel: i18n.view_video_button || 'Xem video',
      rewardLabel: i18n.view_reward_button || 'Ảnh phần thưởng',
    })
  );

  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: 0x2f3136, components: containerChildren }],
  };

  return { payload, attachments: [] };
}

/**
 * Build embed payload for an updated quest.
 * Returns { payload, attachments: [] }.
 */
export async function buildUpdatedQuestEmbed(content, oldQuest, newQuest, assets, changes) {
  const config = newQuest?.config;
  if (!config) return null;

  const questId = newQuest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;
  const restartNote = i18n.note_restart_app || '-# *Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).*';

  const { heroUrl, videoUrl, rewardUrl } = await resolveAssetUrls(config, assets, questId);

  const changeDescription =
    buildChangeDescription(oldQuest, newQuest, changes) || (i18n.no_changes || 'Không có thay đổi');

  const headerLines = [];
  if (PING_ROLE_ID) {
    headerLines.push(
      `<@&${PING_ROLE_ID}> ${i18n.updated_quest_mention || 'Nhiệm Vụ đã cập nhật'} — [${i18n.open_quest || 'Xem chi tiết tại đây'}](${questLink})`
    );
  } else if (content) {
    headerLines.push(content);
  }
  headerLines.push(`# ${questName}`);
  headerLines.push(`*${restartNote}*`);

  const changesText = [`# **${i18n.changes || 'Thay đổi'}**`, changeDescription].join('\n');
  const footerText = `**${i18n.quest_id || 'ID Nhiệm vụ'}**: \`${questId}\``;

  const containerChildren = [textDisplay(headerLines.join('\n'))];

  const gallery = mediaGallery(heroUrl, videoUrl, questName);
  if (gallery) containerChildren.push(gallery);

  containerChildren.push(separator());
  containerChildren.push(sectionOrText(changesText, rewardUrl));
  containerChildren.push(textDisplay(footerText));
  containerChildren.push(separator());
  containerChildren.push(
    linkButtonRow({
      questLink,
      videoUrl,
      rewardUrl,
      openLabel: i18n.open_quest_button || 'Mở nhiệm vụ',
      videoLabel: i18n.view_video_button || 'Xem video',
      rewardLabel: i18n.view_reward_button || 'Ảnh phần thưởng',
    })
  );

  const payload = {
    flags: IS_COMPONENTS_V2,
    components: [{ type: 17, accent_color: 0xffcc00, components: containerChildren }],
  };

  return { payload, attachments: [] };
}

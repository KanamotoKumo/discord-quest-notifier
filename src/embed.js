// src/embed.js
// ─── Embed Builder — 100% Discord Components V2 ────────────────────────────
//
// Rebuilt around the real language/vi-VN.json keys (the previous version
// guessed key names like `platforms`, `requirements_intro`, `open_quest_button`
// that don't actually exist in your i18n file, so those custom emoji labels
// were never shown — everything fell back to my own placeholder text).
//
// Also fixes the two bugs from the screenshot:
//  1. Video only shows for quests that actually have a WATCH_VIDEO /
//     WATCH_VIDEO_ON_MOBILE task. It's now read from that task's own
//     `assets.video/.video_low_res/.video_hls.url`, which only exists on
//     video tasks — instead of `config.assets.hero_video`, which exists on
//     nearly every quest regardless of task type (that's why it was showing
//     up under PLAY_ON_DESKTOP/PLAY_ON_PLAYSTATION quests too).
//  2. Reward icon: decoration rewards' `asset` field is frequently an .mp4
//     (an animated preview) — used directly as a Thumbnail it renders
//     broken. Appending `?format=webp` asks Discord's CDN for a static
//     image instead. Orb/Nitro rewards have no asset of their own at all,
//     so those now use two fixed fallback icons instead of a mismatched URL.
//
// getReward()/formatDate() are inlined here rather than imported from
// utils.js — that file's versions are almost certainly where the
// "[object Object]" text in the screenshot came from (an object landing in
// a template string somewhere neither of us has seen the source of). This
// file no longer depends on utils.js at all, so there's nowhere left for
// that bug to hide.
//
// detectQuestChanges()/buildChangeDescription() are also still unseen, so
// the "updated quest" changes text below is reconstructed directly from
// oldQuest/newQuest using the *_changed keys in vi-VN.json. If the real
// `changes` object passed from main.js doesn't have exactly
// { expires_at, starts_at, reward, task_count } as boolean flags, let me
// know the actual shape and I'll correct it.
import { i18n } from './language.js';
import fs from 'fs/promises';
import path from 'path';

const PING_ROLE_ID = process.env.PING_ROLE_ID || '';
const IS_COMPONENTS_V2 = 1 << 15; // 32768
const CDN_BASE = 'https://cdn.discordapp.com/';
const FALLBACK_ORB_ICON =
  'https://raw.githubusercontent.com/kanamotokumo/discord-quests-notifier/refs/heads/main/assets/orb.png';
const FALLBACK_NITRO_ICON =
  'https://raw.githubusercontent.com/kanamotokumo/discord-quests-notifier/refs/heads/main/assets/nitro.png';

/** Discord timestamp markup — renders as a locale-aware date for whoever's viewing it. */
function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const timestamp = Math.floor(d.getTime() / 1000);
  return `<t:${timestamp}:d>`;
}

/** i18n.rewards maps numeric reward `type` -> readable name (e.g. "4": "Orbs"). */
function getRewardInfo(reward, rewardName) {
  let extraReward = '';
  if (reward?.type === 4 && reward?.premium_orb_quantity) {
    const normalOrbs = String(reward?.orb_quantity || '');
    const premiumOrbs = String(reward?.premium_orb_quantity || '');
    extraReward = `\n**${i18n.reward_name.extra}:** ${String(rewardName).replace(normalOrbs, premiumOrbs)}`;
  }
  let expires = '';
  if (reward?.type === 3 && reward?.expires_at) {
    expires = `\n**${i18n.decor_expires}:** ${formatDate(reward.expires_at)}`;
  }
  const rewardType = i18n.rewards[String(reward?.type)] || i18n.error.reward_type;
  return { rewardType, extraReward, expires };
}

function withWebpFormat(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('format', 'webp');
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Orb/Nitro rewards have no per-reward image of their own — use the fixed
 * fallback icons. Everything else (codes, decorations) uses Discord's own
 * CDN asset for that specific reward, converted to a static image.
 */
function resolveRewardIconUrl(rewardName, primaryReward, assets) {
  const nameLower = String(rewardName || '').toLowerCase();
  if (nameLower.includes('orb')) return FALLBACK_ORB_ICON;
  if (nameLower.includes('nitro')) return FALLBACK_NITRO_ICON;
  if (primaryReward?.asset) return withWebpFormat(`${CDN_BASE}${primaryReward.asset}`);
  return assets?.emptyIconUrl || null;
}

/* ── PLACEHOLDER-aware asset path resolution (unchanged from before) ───────── */

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

async function resolveAssetPath(assetValue, questId) {
  if (!assetValue) return null;
  const trimmed = String(assetValue).trim();
  if (!trimmed) return null;
  if (/PLACEHOLDER/i.test(trimmed) || trimmed.toLowerCase() === 'placeholder') {
    try {
      const state = await readStateFile();
      const prev = state?.quests?.[questId];
      const prevAssets = prev?.config?.assets || {};
      const candidates = [
        prevAssets.hero,
        prevAssets.quest_bar_hero,
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
      // ignore
    }
    return null;
  }
  return trimmed;
}

function buildCdnUrl(assetPath) {
  if (!assetPath) return null;
  const s = String(assetPath).trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `${CDN_BASE}${s.replace(/^\/+/, '')}`;
}

/**
 * Video URL comes from the WATCH_VIDEO(_ON_MOBILE) task's own asset — only
 * those task types have `assets.video`, so this naturally returns null for
 * PLAY_ON_DESKTOP/PLAY_ON_XBOX/etc.-only quests instead of always finding
 * something via config.assets.hero_video.
 */
function extractTaskVideoUrl(tasks) {
  for (const task of Object.values(tasks || {})) {
    const raw = task?.assets?.video?.url || task?.assets?.video_low_res?.url || task?.assets?.video_hls?.url;
    if (raw) return buildCdnUrl(raw);
  }
  return null;
}

/* ── shared component builders ──────────────────────────────────────────── */

const textDisplay = content => ({ type: 10, content });
const separator = (divider = true, spacing = 1) => ({ type: 14, divider, spacing });

function pushRewardSection(children, { rewardIconUrl, rewardBody }) {
  if (rewardIconUrl) {
    children.push({
      type: 9,
      components: [textDisplay(`## ${i18n.rewards_title}`), textDisplay(rewardBody)],
      accessory: { type: 11, media: { url: rewardIconUrl } },
    });
  } else {
    children.push(textDisplay(`## ${i18n.rewards_title}`));
    children.push(textDisplay(rewardBody));
  }
}

/* ── public API ──────────────────────────────────────────────────────────── */

export async function buildNewQuestEmbed(content, quest, assets) {
  const config = quest?.config;
  if (!config) return null;

  const questId = quest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;
  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationLink = config.application?.link || questLink || 'https://discord.com';
  const applicationName = config.application?.name || '';
  const applicationId = config.application?.id || '';
  const restartNote = i18n.note_restart_app || 'Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).';

  const heroPath = await resolveAssetPath(config.assets?.hero || config.assets?.quest_bar_hero, questId);
  const heroUrl = buildCdnUrl(heroPath) || assets?.discordQuests || null;

  const tasks = config.task_config_v2?.tasks || {};
  const videoUrl = extractTaskVideoUrl(tasks);
  const taskCondition = config.task_config_v2?.join_operator || 'or';
  const taskList = Object.values(tasks)
    .map(task => {
      const minutes = task.target ? Math.round(task.target / 60) : 0;
      const taskName = String(task.type || '').replace(/_/g, ' ').trim() || 'TASK';
      return `• ${taskName} (${minutes} phút)`;
    })
    .join('\n');

  const primaryReward = config.rewards_config?.rewards?.[0] || null;
  const rewardName = primaryReward?.messages?.name || i18n.error.reward;
  const skuId = primaryReward?.sku_id || '';
  const rewardExpires = formatDate(config.rewards_config?.rewards_expire_at);
  const { rewardType, extraReward, expires: decorExpires } = getRewardInfo(primaryReward, rewardName);
  const rewardIconUrl = resolveRewardIconUrl(rewardName, primaryReward, assets);

  const durationStr = `${formatDate(config.starts_at)} - ${formatDate(config.expires_at)}`;

  const children = [];
  if (PING_ROLE_ID) children.push(textDisplay(`<@&${PING_ROLE_ID}>`));
  else if (content) children.push(textDisplay(content));

  children.push(textDisplay(`# ${i18n.new_quest} - [${questName}](${questLink})`));

  if (heroUrl) children.push({ type: 12, items: [{ media: { url: heroUrl }, description: questName }] });

  children.push(separator());
  children.push(textDisplay(`*${restartNote}*`));
  children.push(separator());

  children.push(textDisplay(`## ${i18n.quest_info}`));
  children.push(
    textDisplay(
      `**${i18n.duration}:** ${durationStr}\n**${i18n.game}:** ${gameTitle} (${gamePublisher})\n**${i18n.application}:** [${applicationName}](${applicationLink}) (\`${applicationId}\`)`
    )
  );
  children.push(separator());

  children.push(textDisplay(`## ${i18n.tasks}`));
  children.push(textDisplay(`${i18n.task_condition[taskCondition] || i18n.task_condition.or}\n${taskList}`));
  children.push(separator());

  pushRewardSection(children, {
    rewardIconUrl,
    rewardBody: `**${i18n.reward_type}:** ${rewardType}${decorExpires}\n**${i18n.sku_id}:** \`${skuId}\`\n**${i18n.reward_name.normal}:** ${rewardName}${extraReward}\n**${i18n.reward_expires}:** ${rewardExpires}`,
  });

  if (videoUrl) {
    children.push(separator());
    children.push({ type: 12, items: [{ media: { url: videoUrl }, description: applicationName }] });
  }

  children.push(separator());
  children.push(textDisplay(`${i18n.quest_id}: \`${questId}\``));

  const payload = {
    flags: IS_COMPONENTS_V2,
    username: i18n.name,
    avatar_url: assets?.avatarWebhook,
    components: [{ type: 17, components: children }],
  };

  return { payload, attachments: [] };
}

export async function buildUpdatedQuestEmbed(content, oldQuest, newQuest, assets, changes) {
  const config = newQuest?.config;
  if (!config) return null;
  const oldConfig = oldQuest?.config || {};

  const questId = newQuest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const questLink = `https://canary.discord.com/quests/${questId}`;
  const restartNote = i18n.note_restart_app || 'Nếu như không thấy nhiệm vụ trong app Discord, trước hết phải khởi động lại ứng dụng. Nếu vẫn không thấy thì fake IP sang US, UK, v.v. Chúng tôi sẽ gửi thông báo về yêu cầu về IP vào mỗi buổi trưa (nếu có).';

  const heroPath = await resolveAssetPath(config.assets?.hero || config.assets?.quest_bar_hero, questId);
  const heroUrl = buildCdnUrl(heroPath) || assets?.discordQuests || null;
  const videoUrl = extractTaskVideoUrl(config.task_config_v2?.tasks);

  const fmt = (label, oldVal, newVal) => `**${label}:** ${i18n.changed_from} ${oldVal} ${i18n.changed_to} ${newVal}`;
  const changeLines = [];
  if (changes?.expires_at) {
    changeLines.push(fmt(i18n.expires_at_changed, formatDate(oldConfig.expires_at), formatDate(config.expires_at)));
  }
  if (changes?.starts_at) {
    changeLines.push(fmt(i18n.starts_at_changed, formatDate(oldConfig.starts_at), formatDate(config.starts_at)));
  }
  if (changes?.reward) {
    const oldReward = oldConfig.rewards_config?.rewards?.[0]?.messages?.name || i18n.error.reward;
    const newReward = config.rewards_config?.rewards?.[0]?.messages?.name || i18n.error.reward;
    changeLines.push(fmt(i18n.reward_changed, oldReward, newReward));
  }
  if (changes?.task_count) {
    const oldCount = Object.keys(oldConfig.task_config_v2?.tasks || {}).length;
    const newCount = Object.keys(config.task_config_v2?.tasks || {}).length;
    changeLines.push(fmt(i18n.task_count_changed, oldCount, newCount));
  }
  const changesText = changeLines.length ? changeLines.join('\n') : i18n.no_changes || 'Không có thay đổi';

  const children = [];
  if (PING_ROLE_ID) children.push(textDisplay(`<@&${PING_ROLE_ID}>`));
  else if (content) children.push(textDisplay(content));

  children.push(textDisplay(`# ${i18n.updated_quest} - [${questName}](${questLink})`));

  if (heroUrl) children.push({ type: 12, items: [{ media: { url: heroUrl }, description: questName }] });

  children.push(separator());
  children.push(textDisplay(`*${restartNote}*`));
  children.push(separator());

  children.push(textDisplay(`## ${i18n.changes_detected}`));
  children.push(textDisplay(changesText));

  if (videoUrl) {
    children.push(separator());
    children.push({ type: 12, items: [{ media: { url: videoUrl }, description: questName }] });
  }

  children.push(separator());
  children.push(textDisplay(`${i18n.quest_id}: \`${questId}\``));

  const payload = {
    flags: IS_COMPONENTS_V2,
    username: i18n.name,
    avatar_url: assets?.avatarWebhook,
    components: [{ type: 17, components: children }],
  };

  return { payload, attachments: [] };
}

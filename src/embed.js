// src/embed.js
// ─── Embed Builder — 100% Discord Components V2 ────────────────────────────
//
// Structure follows the mockups exactly:
//  - New quest:    [ping?] ### heading -> hero image -> -# restart note ->
//                  ## Thông tin nhiệm vụ -> ## Yêu cầu -> ## Phần thưởng ->
//                  -# quest id
//  - Updated quest: ### heading -> hero image ONLY (never a video) ->
//                   ## Thay đổi -> -# quest id
//                   Never pings the role, even if PING_ROLE_ID is set.
//
// Two behavior notes since they're not obvious from reading the code:
//  1. No video is shown anywhere anymore (hero is image-only, always) —
//     dropped per explicit instruction, not because of a bug this time.
//  2. buildUpdatedQuestEmbed no longer trusts the `changes` flags object
//     from main.js/detectQuestChanges (still unseen, and didn't cover
//     enough fields anyway). It diffs oldQuest.config vs newQuest.config
//     itself for all 7 fields the mockup lists, and only prints a line for
//     a field that actually changed. `changes` is no longer a parameter —
//     main.js can keep passing it, JS just ignores the extra argument.
import { i18n } from './language.js';
import { decodeFeatures } from './state.js';
import fs from 'fs/promises';
import path from 'path';

const PING_ROLE_ID = process.env.PING_ROLE_ID || '';
const IS_COMPONENTS_V2 = 1 << 15; // 32768
const CDN_BASE = 'https://cdn.discordapp.com/';
const FALLBACK_ORB_ICON =
  'https://raw.githubusercontent.com/kanamotokumo/discord-quests-notifier/refs/heads/main/assets/orb.png';
const FALLBACK_NITRO_ICON =
  'https://raw.githubusercontent.com/kanamotokumo/discord-quests-notifier/refs/heads/main/assets/nitro.png';

/** Discord timestamp markup, full date+time — renders in whoever's viewing it own locale. */
function formatDate(isoString) {
  if (!isoString) return '';
  const timestamp = Math.floor(new Date(isoString).getTime() / 1000);
  return `<t:${timestamp}:f>`;
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

/** Orb/Nitro rewards get fixed fallback icons; codes/decorations use Discord's own asset. */
function resolveRewardIconUrl(rewardName, primaryReward, assets) {
  const nameLower = String(rewardName || '').toLowerCase();
  if (nameLower.includes('orb')) return FALLBACK_ORB_ICON;
  if (nameLower.includes('nitro')) return FALLBACK_NITRO_ICON;
  if (primaryReward?.asset) return withWebpFormat(`${CDN_BASE}${primaryReward.asset}`);
  return assets?.emptyIconUrl || null;
}

/** PLAY_ON_* task keys are the only real signal for which platforms a quest supports. */
function derivePlatformsText(config) {
  const taskKeys = Object.keys(config?.task_config_v2?.tasks || {});
  const map = { PLAY_ON_DESKTOP: 'PC', PLAY_ON_XBOX: 'Xbox', PLAY_ON_PLAYSTATION: 'PlayStation' };
  const matched = taskKeys.map(k => map[k]).filter(Boolean);
  return matched.length ? matched.join(', ') : 'Đa nền tảng';
}

function taskDisplayName(task) {
  return String(task?.type || '').replace(/_/g, ' ').trim() || 'TASK';
}

function taskMinutes(task) {
  return task?.target ? Math.round(task.target / 60) : 0;
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
        prevAssets.hero, prevAssets.quest_bar_hero,
        prevAssets.game_tile, prevAssets.game_tile_light, prevAssets.game_tile_dark,
        prevAssets.logotype, prevAssets.logotype_light, prevAssets.logotype_dark,
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

async function resolveHeroUrl(config, assets, questId) {
  const heroPath = await resolveAssetPath(config?.assets?.hero || config?.assets?.quest_bar_hero, questId);
  return buildCdnUrl(heroPath) || assets?.discordQuests || null;
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

/* ── change detection (self-contained — diffs config objects directly) ──── */

function summarizeTasks(config) {
  const tasks = Object.values(config?.task_config_v2?.tasks || {});
  if (!tasks.length) return '—';
  return tasks.map(t => `${taskDisplayName(t)} (${taskMinutes(t)}p)`).join(', ');
}

function changeLine(label, oldVal, newVal, multiline = false) {
  return multiline ? `**${label}**: ~~${oldVal}~~\n→ ${newVal}` : `**${label}**: ~~${oldVal}~~ → ${newVal}`;
}

function buildChangesText(oldConfig, newConfig) {
  const lines = [];

  const oldDuration = `${formatDate(oldConfig.starts_at)} - ${formatDate(oldConfig.expires_at)}`;
  const newDuration = `${formatDate(newConfig.starts_at)} - ${formatDate(newConfig.expires_at)}`;
  if (oldDuration !== newDuration) lines.push(changeLine(i18n.duration, oldDuration, newDuration, true));

  const oldExp = formatDate(oldConfig.rewards_config?.rewards_expire_at);
  const newExp = formatDate(newConfig.rewards_config?.rewards_expire_at);
  if (oldExp !== newExp) lines.push(changeLine(i18n.reward_expires, oldExp, newExp, true));

  const oldFeatures = decodeFeatures(oldConfig.features).sort().join(', ') || '—';
  const newFeatures = decodeFeatures(newConfig.features).sort().join(', ') || '—';
  if (oldFeatures !== newFeatures) lines.push(changeLine(i18n.features, oldFeatures, newFeatures));

  const oldGame = `${oldConfig.messages?.game_title || i18n.error.game_name} (${oldConfig.messages?.game_publisher || i18n.error.game_publisher})`;
  const newGame = `${newConfig.messages?.game_title || i18n.error.game_name} (${newConfig.messages?.game_publisher || i18n.error.game_publisher})`;
  if (oldGame !== newGame) lines.push(changeLine(i18n.game, oldGame, newGame));

  const oldTasks = summarizeTasks(oldConfig);
  const newTasks = summarizeTasks(newConfig);
  if (oldTasks !== newTasks) lines.push(changeLine(i18n.tasks, oldTasks, newTasks));

  const oldPlatforms = derivePlatformsText(oldConfig);
  const newPlatforms = derivePlatformsText(newConfig);
  if (oldPlatforms !== newPlatforms) lines.push(changeLine(i18n.platforms, oldPlatforms, newPlatforms));

  const oldApp = `${oldConfig.application?.name || ''} (${oldConfig.application?.id || ''})`;
  const newApp = `${newConfig.application?.name || ''} (${newConfig.application?.id || ''})`;
  if (oldApp !== newApp) lines.push(changeLine(i18n.application, oldApp, newApp));

  return lines.length ? lines.join('\n\n') : i18n.no_changes;
}

/* ── public API ──────────────────────────────────────────────────────────── */

export async function buildNewQuestEmbed(content, quest, assets) {
  const config = quest?.config;
  if (!config) return null;

  const questId = quest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;
  const gameTitle = config.messages?.game_title || i18n.error.game_name;
  const gamePublisher = config.messages?.game_publisher || i18n.error.game_publisher;
  const applicationName = config.application?.name || '';
  const applicationId = config.application?.id || '';

  const heroUrl = await resolveHeroUrl(config, assets, questId);

  const tasks = config.task_config_v2?.tasks || {};
  const taskCondition = config.task_config_v2?.join_operator || 'or';
  const taskList = Object.values(tasks)
    .map(t => `*   ${taskDisplayName(t)} (${taskMinutes(t)} phút)`)
    .join('\n');

  const primaryReward = config.rewards_config?.rewards?.[0] || null;
  const rewardName = primaryReward?.messages?.name || i18n.error.reward;
  const skuId = primaryReward?.sku_id || '';
  const { rewardType, extraReward, expires: decorExpires } = getRewardInfo(primaryReward, rewardName);
  const rewardIconUrl = resolveRewardIconUrl(rewardName, primaryReward, assets);

  const durationStr = `${formatDate(config.starts_at)} - ${formatDate(config.expires_at)}`;
  const rewardExpiresStr = formatDate(config.rewards_config?.rewards_expire_at);
  const platforms = derivePlatformsText(config);
  const features = decodeFeatures(config.features).join(', ') || '—';

  const children = [];
  if (PING_ROLE_ID) children.push(textDisplay(`<@&${PING_ROLE_ID}>`));
  else if (content) children.push(textDisplay(content));

  children.push(textDisplay(`### ${i18n.new_quest} - ${questName}`));

  if (heroUrl) children.push({ type: 12, items: [{ media: { url: heroUrl }, description: questName }] });

  children.push(textDisplay(`-# *${i18n.note_restart_app}*`));

  children.push(textDisplay(`## ${i18n.quest_info}`));
  children.push(
    textDisplay(
      `**${i18n.duration}**: ${durationStr}\n**${i18n.reward_expires}**: ${rewardExpiresStr}\n**${i18n.platforms}**: ${platforms}\n**${i18n.game}**: ${gameTitle} (${gamePublisher})\n**${i18n.application}**: ${applicationName} (\`${applicationId}\`)\n**${i18n.features}**: ${features}`
    )
  );

  children.push(textDisplay(`## ${i18n.tasks}`));
  children.push(textDisplay(`${i18n.task_condition[taskCondition] || i18n.task_condition.or}\n${taskList}`));

  pushRewardSection(children, {
    rewardIconUrl,
    rewardBody: `**${i18n.reward_type}**: ${rewardType}\n**${i18n.sku_id}**: \`${skuId}\`\n**${i18n.reward_name.normal}**: ${rewardName}${extraReward}${decorExpires}`,
  });

  children.push(textDisplay(`-# **${i18n.quest_id}**: \`${questId}\``));

  const payload = {
    flags: IS_COMPONENTS_V2,
    username: i18n.name,
    avatar_url: assets?.avatarWebhook,
    components: [{ type: 17, components: children }],
  };

  return { payload, attachments: [] };
}

/**
 * Never pings PING_ROLE_ID — updates are intentionally quiet. Diffs
 * oldQuest.config vs newQuest.config itself rather than trusting an
 * externally-computed `changes` object (see file header).
 */
export async function buildUpdatedQuestEmbed(content, oldQuest, newQuest, assets) {
  const config = newQuest?.config;
  if (!config) return null;
  const oldConfig = oldQuest?.config || {};

  const questId = newQuest.id || '';
  const questName = config.messages?.quest_name || i18n.error.new_quest;

  const heroUrl = await resolveHeroUrl(config, assets, questId);
  const changesText = buildChangesText(oldConfig, config);

  const children = [];
  if (content) children.push(textDisplay(content));

  children.push(textDisplay(`### ${i18n.updated_quest} - ${questName}`));

  if (heroUrl) children.push({ type: 12, items: [{ media: { url: heroUrl }, description: questName }] });

  children.push(textDisplay(`## ${i18n.changes_title}`));
  children.push(textDisplay(changesText));

  children.push(textDisplay(`-# **${i18n.quest_id}**: \`${questId}\``));

  const payload = {
    flags: IS_COMPONENTS_V2,
    username: i18n.name,
    avatar_url: assets?.avatarWebhook,
    components: [{ type: 17, components: children }],
  };

  return { payload, attachments: [] };
}

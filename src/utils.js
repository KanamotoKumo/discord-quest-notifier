// ─── Utility Functions ────────────────────────────────────────────────────
import { i18n } from './language.js';

/**
 * Format ISO date to Discord timestamp (date only)
 */
export function formatDate(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    const timestamp = Math.floor(d.getTime() / 1000);
    return `<t:${timestamp}:d>`;
}

/**
 * Format ISO date to Discord timestamp with time
 */
export function formatDateTime(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    const timestamp = Math.floor(d.getTime() / 1000);
    return `<t:${timestamp}:f>`;
}

/**
 * Get reward info from quest reward object
 */
export function getReward(reward, rewardName) {
    let extraReward = '';
    if (reward?.type === 4 && reward?.premium_orb_quantity) {
        const normalOrbs = String(reward?.orb_quantity || '');
        const premiumOrbs = String(reward?.premium_orb_quantity || '');
        extraReward = `\n**${i18n.reward_name.extra}:** ${String(rewardName).replace(normalOrbs, premiumOrbs)}`;
    }

    let expires = '';
    if (reward?.type === 3 && reward?.expires_at) {
        expires = `\n**${i18n.decor_expires}:** ${formatDate(reward?.expires_at)}`;
    }

    const keyword = Object.keys(i18n.rewards).find(key => reward?.type == key);
    return {
        rewardType: i18n.rewards[String(keyword)] || i18n.error.reward_type,
        extraReward,
        expires
    };
}

/**
 * Helper: safe stringify for comparison (ignores ordering of object keys)
 */
function stableStringify(obj) {
    if (obj === undefined) return '';
    try {
        const allKeys = [];
        JSON.stringify(obj, (k, v) => { allKeys.push(k); return v; });
        allKeys.sort();
        return JSON.stringify(obj, allKeys);
    } catch (e) {
        return String(obj);
    }
}

/**
 * Compare two quests and detect changes
 *
 * oldQuest may be the saved state entry (with .config) or a full quest object.
 * newQuest is the fresh quest object from API.
 */
export function detectQuestChanges(oldQuest, newQuest) {
    const changes = {
        starts_at: false,
        expires_at: false,
        reward_expires: false,
        task_count: false,
        task_changes: false,    // tasks changed in detail (type/target/assets)
        reward_type: false,
        sku_id: false,
        hero_image: false,
        hero_video: false,
        quest_name: false,
        features: false,
        application_id: false,
        cta_link: false
    };

    const oldConfig = (oldQuest && oldQuest.config) ? oldQuest.config : (oldQuest || {});
    const newConfig = newQuest?.config || {};

    // starts_at / expires_at
    if ((oldConfig.starts_at || '') !== (newConfig.starts_at || '')) {
        changes.starts_at = true;
    }
    if ((oldConfig.expires_at || '') !== (newConfig.expires_at || '')) {
        changes.expires_at = true;
    }

    // reward expiration
    const oldRewardExp = oldConfig.rewards_config?.rewards_expire_at || '';
    const newRewardExp = newConfig.rewards_config?.rewards_expire_at || '';
    if (oldRewardExp !== newRewardExp) {
        changes.reward_expires = true;
    }

    // task count
    const oldTasks = oldConfig.task_config_v2?.tasks || {};
    const newTasks = newConfig.task_config_v2?.tasks || {};
    const oldTaskCount = Object.keys(oldTasks).length;
    const newTaskCount = Object.keys(newTasks).length;
    if (oldTaskCount !== newTaskCount) {
        changes.task_count = true;
        changes.task_changes = true;
    } else {
        // if same count, check detailed differences per task key
        const oldTasksStr = stableStringify(oldTasks);
        const newTasksStr = stableStringify(newTasks);
        if (oldTasksStr !== newTasksStr) {
            changes.task_changes = true;
        }
    }

    // reward type and sku
    const oldReward = oldConfig.rewards_config?.rewards?.[0] || {};
    const newReward = newConfig.rewards_config?.rewards?.[0] || {};
    if ((oldReward.type || '') !== (newReward.type || '')) {
        changes.reward_type = true;
    }
    if ((oldReward.sku_id || '') !== (newReward.sku_id || '')) {
        changes.sku_id = true;
    }

    // hero image / hero video
    const oldHero = oldConfig.assets?.hero || '';
    const newHero = newConfig.assets?.hero || '';
    if (oldHero !== newHero) {
        changes.hero_image = true;
    }
    const oldHeroVideo = oldConfig.assets?.hero_video || oldConfig.assets?.quest_bar_hero_video || '';
    const newHeroVideo = newConfig.assets?.hero_video || newConfig.assets?.quest_bar_hero_video || '';
    if (oldHeroVideo !== newHeroVideo) {
        changes.hero_video = true;
    }

    // quest name
    const oldName = oldConfig.messages?.quest_name || '';
    const newName = newConfig.messages?.quest_name || '';
    if (oldName !== newName) {
        changes.quest_name = true;
    }

    // features (array)
    const oldFeatures = Array.isArray(oldConfig.features) ? oldConfig.features.join(',') : String(oldConfig.features || '');
    const newFeatures = Array.isArray(newConfig.features) ? newConfig.features.join(',') : String(newConfig.features || '');
    if (oldFeatures !== newFeatures) {
        changes.features = true;
    }

    // application id
    const oldAppId = oldConfig.application?.id || '';
    const newAppId = newConfig.application?.id || '';
    if (oldAppId !== newAppId) {
        changes.application_id = true;
    }

    // cta link
    const oldCta = oldConfig.cta_config?.link || '';
    const newCta = newConfig.cta_config?.link || '';
    if (oldCta !== newCta) {
        changes.cta_link = true;
    }

    return changes;
}

/**
 * Build change description for embed
 * Only include lines for fields that actually changed (based on changes flags)
 */
export function buildChangeDescription(oldQuest, newQuest, changes) {
    const oldConfig = (oldQuest && oldQuest.config) ? oldQuest.config : (oldQuest || {});
    const newConfig = newQuest?.config || {};
    const lines = [];

    if (changes.expires_at) {
        lines.push(`**${i18n.expires_at_changed}:** ${formatDateTime(oldConfig.expires_at)} → ${formatDateTime(newConfig.expires_at)}`);
    }

    if (changes.starts_at) {
        lines.push(`**${i18n.starts_at_changed}:** ${formatDateTime(oldConfig.starts_at)} → ${formatDateTime(newConfig.starts_at)}`);
    }

    if (changes.reward_expires) {
        const oldExp = formatDate(oldConfig.rewards_config?.rewards_expire_at);
        const newExp = formatDate(newConfig.rewards_config?.rewards_expire_at);
        lines.push(`**${i18n.reward_expires}:** ${oldExp} → ${newExp}`);
    }

    if (changes.task_count || changes.task_changes) {
        // Provide a compact diff: old task keys → new task keys, and if possible show changed task types/targets
        const oldTasks = oldConfig.task_config_v2?.tasks || {};
        const newTasks = newConfig.task_config_v2?.tasks || {};
        const oldKeys = Object.keys(oldTasks);
        const newKeys = Object.keys(newTasks);

        // If keys differ, show counts and keys
        if (JSON.stringify(oldKeys) !== JSON.stringify(newKeys)) {
            lines.push(`**${i18n.task_count_changed}:** ${oldKeys.length} → ${newKeys.length}`);
            lines.push(`**${i18n.task_keys_old}:** ${oldKeys.length ? oldKeys.join(', ') : '—'}`);
            lines.push(`**${i18n.task_keys_new}:** ${newKeys.length ? newKeys.join(', ') : '—'}`);
        } else {
            // same keys but details changed: show per-key diff (type/target)
            const diffs = [];
            for (const k of newKeys) {
                const o = oldTasks[k] || {};
                const n = newTasks[k] || {};
                const oStr = stableStringify({ type: o.type, target: o.target, assets: o.assets || null });
                const nStr = stableStringify({ type: n.type, target: n.target, assets: n.assets || null });
                if (oStr !== nStr) {
                    diffs.push(`- ${k}: ${o.type || '—'} (${o.target || 0}) → ${n.type || '—'} (${n.target || 0})`);
                }
            }
            if (diffs.length) {
                lines.push(`**${i18n.task_changes}:**`);
                lines.push(diffs.join('\n'));
            } else {
                lines.push(`**${i18n.task_count_changed}:** ${oldKeys.length} → ${newKeys.length}`);
            }
        }
    }

    if (changes.reward_type) {
        const oldType = oldConfig.rewards_config?.rewards?.[0]?.type;
        const newType = newConfig.rewards_config?.rewards?.[0]?.type;
        lines.push(`**${i18n.reward_type_changed}:** ${oldType ?? '—'} → ${newType ?? '—'}`);
    }

    if (changes.sku_id) {
        const oldSku = oldConfig.rewards_config?.rewards?.[0]?.sku_id || '—';
        const newSku = newConfig.rewards_config?.rewards?.[0]?.sku_id || '—';
        lines.push(`**${i18n.sku_changed}:** \`${oldSku}\` → \`${newSku}\``);
    }

    if (changes.hero_image) {
        const oldHero = oldConfig.assets?.hero ? `https://cdn.discordapp.com/${oldConfig.assets.hero}` : '—';
        const newHero = newConfig.assets?.hero ? `https://cdn.discordapp.com/${newConfig.assets.hero}` : '—';
        lines.push(`**${i18n.hero_image_changed}:** ${oldHero} → ${newHero}`);
    }

    if (changes.hero_video) {
        const oldV = oldConfig.assets?.hero_video || oldConfig.assets?.quest_bar_hero_video || '—';
        const newV = newConfig.assets?.hero_video || newConfig.assets?.quest_bar_hero_video || '—';
        lines.push(`**${i18n.hero_video_changed}:** ${oldV ? `\`${oldV}\`` : '—'} → ${newV ? `\`${newV}\`` : '—'}`);
    }

    if (changes.quest_name) {
        const oldName = oldConfig.messages?.quest_name || '—';
        const newName = newConfig.messages?.quest_name || '—';
        lines.push(`**${i18n.quest_name_changed}:** ${oldName} → ${newName}`);
    }

    if (changes.features) {
        const oldF = Array.isArray(oldConfig.features) ? oldConfig.features.join(',') : (oldConfig.features || '—');
        const newF = Array.isArray(newConfig.features) ? newConfig.features.join(',') : (newConfig.features || '—');
        lines.push(`**${i18n.features_changed}:** ${oldF} → ${newF}`);
    }

    if (changes.application_id) {
        const oldApp = oldConfig.application?.id || '—';
        const newApp = newConfig.application?.id || '—';
        lines.push(`**${i18n.application_changed}:** ${oldApp} → ${newApp}`);
    }

    if (changes.cta_link) {
        const oldCta = oldConfig.cta_config?.link || '—';
        const newCta = newConfig.cta_config?.link || '—';
        lines.push(`**${i18n.cta_changed}:** ${oldCta} → ${newCta}`);
    }

    return lines.join('\n');
}

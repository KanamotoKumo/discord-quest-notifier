// ─── Webhook ──────────────────────────────────────────────────────────────
import { error } from './logging.js';

export async function sendWebhook(webhookUrl, embed, wait = true) {
    if (!webhookUrl) {
        error('Webhook URL is empty');
        return false;
    }

    try {
        const url = new URL(webhookUrl);
        if (wait) url.searchParams.append('wait', 'true');

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            body: JSON.stringify(embed),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Webhook error ${response.status}: ${body}`);
        }

        return true;
    } catch (err) {
        error(`Failed to send webhook: ${err.message}`);
        return false;
    }
}

export async function sendErrorNotice(message) {
    const { ERR_WEBHOOK } = await import('./config.js');
    if (!ERR_WEBHOOK) return;

    const embed = {
        username: '⚠️ Discord Quests Notifier - Error',
        content: `\`\`\`\n${message}\n\`\`\``,
    };

    await sendWebhook(ERR_WEBHOOK, embed, false);
} 

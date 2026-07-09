// ─── Discord API ──────────────────────────────────────────────────────────
import { DISCORD_TOKEN } from './config.js';

export async function fetchQuests() {
    const res = await fetch('https://discord.com/api/v9/quests/@me', {
        headers: {
            Authorization: DISCORD_TOKEN,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'X-Super-Properties': Buffer.from(JSON.stringify({
                os: 'Windows',
                browser: 'Chrome',
                device: '',
            })).toString('base64'),
        },
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Discord API ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.quests || [];
          } 

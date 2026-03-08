import { search } from '../../scrape/ytsearch.js'

const fmtViews = (v) => {
    const n = Number(String(v || '').replace(/[^0-9]/g, ''))
    if (!Number.isFinite(n) || n <= 0) return '-'
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(n)
}

export default {
    name: 'ytsearch',
    aliases: ['yts'],
    description: 'Cari video youtube',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} night changes`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const results = await search(q, 15)
            if (!results?.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil untuk: ${q}`
                }, { quoted: msg })
            }

            const lines = results.map((item, i) => (
                `${i + 1}. ${item.title}\n` +
                `• Channel: ${item.channel}\n` +
                `• Duration: ${item.duration}\n` +
                `• Views: ${fmtViews(item.views)}\n` +
                `• Link: ${item.url}`
            ))

            const firstThumb = results[0]?.thumbnail || results[0]?.thumbnailHD || ''
            const caption = `\`\`\`${lines.join('\n\n')}\`\`\``

            if (firstThumb) {
                await sock.sendMessage(jid, {
                    image: { url: firstThumb },
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}

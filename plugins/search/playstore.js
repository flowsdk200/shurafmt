import axios from 'axios'

export default {
    name: 'playstore',
    aliases: ['ps', 'playstoresearch'],
    description: 'Cari aplikasi di play store',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} WhatsApp`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { data } = await axios.get('https://api.baguss.xyz/api/search/playstore', {
                params: { q },
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            })

            const items = Array.isArray(data?.result) ? data.result : []
            const picked = items.slice(0, 10)

            if (!picked.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil play store untuk: ${q}`
                }, { quoted: msg })
            }

            const lines = picked.map((item, i) => (
                `${i + 1}. ${item.nama || '-'}\n` +
                `× Developer: ${item.developer || '-'}\n` +
                `× Rating: ${item.rate2 || item.rate || '-'}\n` +
                `× Link: ${item.link || '-'}`
            ))

            await sock.sendMessage(jid, {
                text: `\`\`\`${lines.join('\n\n')}\`\`\``
            }, { quoted: msg })

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

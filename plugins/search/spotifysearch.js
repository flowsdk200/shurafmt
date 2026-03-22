import { searchTracks } from '../../scrape/spotify.js'

export default {
    name: 'spotifysearch',
    aliases: ['sps', 'spsearch'],
    description: 'Cari lagu Spotify',
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
            const results = await searchTracks(q, 15)
            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil untuk: ${q}`
                }, { quoted: msg })
            }

            const lines = results.map((item, i) => (
                `${i + 1}. ${item.title}\n` +
                `• Artist: ${item.artists || '-'}\n` +
                `• Duration: ${item.durationFormatted || '-'}\n` +
                `• Link: ${item.url || '-'}`
            ))

            const thumb = results[0]?.image || ''
            const caption = `\`\`\`${lines.join('\n\n')}\`\`\``

            if (thumb) {
                await sock.sendMessage(jid, {
                    image: { url: thumb },
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
                text: `❌ Gagal mencari Spotify: ${err.message}`
            }, { quoted: msg })
        }
    }
}

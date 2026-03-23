import { getVideo, isFacebookUrl } from '../../scrape/facebook.js'

const findBestMedia = (result) => {
    const medias = Array.isArray(result?.medias) ? result.medias : []
    if (medias.length === 0) return null

    if (result.bestMedia) return result.bestMedia

    return medias
        .filter((m) => String(m?.url || '').startsWith('http'))
        .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0] || null
}

export default {
    name: 'facebook',
    aliases: ['fb', 'fbdl', 'facebookdl'],
    description: 'Download video Facebook',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://www.facebook.com/share/r/175QAep8VY/`
            }, { quoted: msg })
        }

        if (!isFacebookUrl(q)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari facebook'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await getVideo(q)
            const media = findBestMedia(result)

            if (!media?.url) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Video tidak ditemukan dari link tersebut.'
                }, { quoted: msg })
            }

            await sock.sendMessage(jid, {
                video: { url: media.url },
                mimetype: 'video/mp4'
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

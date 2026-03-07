import { getVideo, isFacebookUrl } from '../../scrape/facebook.js'

const fmtSize = (value) => {
    const size = Number(value || 0)
    if (!size || !Number.isFinite(size)) return ''
    if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
    if (size >= 1024) return `${(size / 1024).toFixed(2)} KB`
    return `${size} B`
}

const formatDuration = (value) => {
    const duration = Number(value || 0)
    if (!duration || !Number.isFinite(duration) || duration <= 0) return ''

    const m = Math.floor(duration / 60)
    const s = String(duration % 60).padStart(2, '0')
    return `${m}m ${s}s`
}

const buildCaption = (result) => {
    const size = fmtSize(result.bestMedia?.size)
    const length = formatDuration(result.duration)

    return [
        `\`\`\`× Title: ${result.title || '-'}`,
        `× Duration: ${length || '-'}`,
        `× Quality: ${result.bestMedia?.quality || '-'}`,
        `× Size: ${size || '-'}\`\`\``
    ].join('\n')
}

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

            const caption = buildCaption({
                title: result.title,
                duration: result.duration,
                source: result.source,
                bestMedia: media
            })

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

import { yt1sdl } from '../../scrape/yt1s.js'
import { getBuffer, toAudio } from '../../src/utils/converter.js'

export default {
    name: 'ytmp3',
    aliases: ['yta'],
    description: 'Download youtube mp3 dari link',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://youtu.be/jpFZe_ashHc`
            }, { quoted: msg })
        }

        if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(q)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari youtube'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const res = await yt1sdl(q, { type: 'audio', audioQuality: '128' })
            const audioInfo = Array.isArray(res?.audio) ? res.audio.find((x) => x?.url) : null

            if (!audioInfo?.url) {
                await react('❌')
                return sock.sendMessage(jid, { text: '❌ Audio tidak tersedia untuk video ini.' }, { quoted: msg })
            }

            const raw = await getBuffer(audioInfo.url, { timeout: 120000, maxRedirects: 5 })
            const ext = String(audioInfo.format || 'mp3').toLowerCase()
            const converted = await toAudio(raw, ext)
            const audio = converted?.data || converted

            const channelName = String(res?.channel?.name || '-').trim()
            const durasi = String(res?.durationLabel || '-').trim()

            let thumbBuffer = null
            let thumbUrl = ''
            if (res?.thumbnail) {
                thumbUrl = res.thumbnail
                try {
                    const tb = await getBuffer(res.thumbnail, { timeout: 15000, maxRedirects: 3 })
                    if (Buffer.isBuffer(tb) && tb.length) thumbBuffer = tb
                } catch {}
            }

            await sock.sendMessage(jid, {
                audio,
                mimetype: 'audio/mpeg',
                fileName: `${res.title}.mp3`,
                ptt: false,
                ...(thumbBuffer || thumbUrl ? {
                    contextInfo: {
                        externalAdReply: {
                            title: res.title,
                            body: `${channelName}`,
                            ...(thumbBuffer ? { thumbnail: thumbBuffer } : {}),
                            ...(thumbUrl ? { thumbnailUrl: thumbUrl } : {}),
                            mediaUrl: q,
                            sourceUrl: q,
                            mediaType: 1,
                            showAdAttribution: false,
                            renderLargerThumbnail: true
                        }
                    }
                } : {})
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}

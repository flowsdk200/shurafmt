import { yt1sdl } from '../../scrape/yt1s.js'
import { search } from '../../scrape/ytsearch.js'
import { getBuffer, toAudio } from '../../src/utils/converter.js'

export default {
    name: 'play',
    aliases: ['ytplay'],
    description: 'Cari lagu YouTube lalu kirim audio hasil pertama',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!text?.trim()) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} night changes`
            }, { quoted: msg })
        }

        const q = text.trim()
        const isUrl = q.includes('youtube.com') || q.includes('youtu.be')
        let url = q
        let metaFromSearch = null

        if (!isUrl) {
            try {
                const res = await search(q, 1)
                if (!res || res.length === 0) {
                    return sock.sendMessage(jid, { text: `❌ Tidak ditemukan hasil untuk: ${q}` }, { quoted: msg })
                }
                metaFromSearch = res[0]
                url = res[0].url
            } catch {
                return sock.sendMessage(jid, { text: '❌ Gagal mencari video.' }, { quoted: msg })
            }
        }

        await react('⏳')

        try {
            const res = await yt1sdl(url, { type: 'audio', audioQuality: '128' })
            const audioInfo = Array.isArray(res?.audio)
                ? (res.audio.find((x) => x?.url) || null)
                : null

            if (!audioInfo?.url) {
                return sock.sendMessage(jid, { text: '❌ Audio tidak tersedia untuk video ini.' }, { quoted: msg })
            }

            const buff = await getBuffer(audioInfo.url, { timeout: 120000, maxRedirects: 5 })
            if (!Buffer.isBuffer(buff) || buff.length === 0) {
                return sock.sendMessage(jid, { text: '❌ Gagal ambil buffer audio.' }, { quoted: msg })
            }

            const ext = String(audioInfo.format || 'mp3').toLowerCase()
            const converted = await toAudio(buff, ext)
            const audio = converted?.data || converted
            if (!Buffer.isBuffer(audio) || audio.length === 0) {
                return sock.sendMessage(jid, { text: '❌ Error.' }, { quoted: msg })
            }

            const channelName = String(res?.channel?.name || metaFromSearch?.channel || '-').trim()
            const durasi = String(res?.durationLabel || metaFromSearch?.duration || '-').trim()

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
                            body: `${channelName} • ${durasi}`,
                            ...(thumbBuffer ? { thumbnail: thumbBuffer } : {}),
                            ...(thumbUrl ? { thumbnailUrl: thumbUrl } : {}),
                            mediaUrl: url,
                            sourceUrl: url,
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

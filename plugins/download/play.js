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
        let candidates = []

        if (!isUrl) {
            try {
                const res = await search(q, 5)
                if (!res || res.length === 0) {
                    return sock.sendMessage(jid, { text: `❌ Tidak ditemukan hasil untuk: ${q}` }, { quoted: msg })
                }
                candidates = res
                metaFromSearch = res[0]
                url = res[0].url
            } catch {
                return sock.sendMessage(jid, { text: '❌ Gagal mencari video.' }, { quoted: msg })
            }
        }

        await react('⏳')

        try {
            const tryOne = async (candidateUrl, candidateMeta = null) => {
                const r = await yt1sdl(candidateUrl, { type: 'audio', audioQuality: '128' })
                const a = Array.isArray(r?.audio)
                    ? (r.audio.find((x) => x?.url) || null)
                    : null
                return { r, a, candidateMeta }
            }

            let picked = null

            if (isUrl) {
                picked = await tryOne(url, null)
            } else {
                let lastErr = null
                for (const item of candidates) {
                    try {
                        picked = await tryOne(item.url, item)
                        if (picked?.a?.url) {
                            url = item.url
                            metaFromSearch = item
                            break
                        }
                    } catch (err) {
                        lastErr = err
                    }
                }
                if (!picked?.a?.url && lastErr) throw lastErr
            }

            const res = picked?.r
            const audioInfo = picked?.a || null

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

            const channelFallback = String(metaFromSearch?.channel || '-').trim()
            const channelPrimary = String(res?.channel?.name || '').trim()
            const channelName = channelPrimary && channelPrimary.toLowerCase() !== 'youtube'
                ? channelPrimary
                : channelFallback
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

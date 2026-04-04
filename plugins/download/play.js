import { yt1sdl } from '../../scrape/yt1s.js'
import { search } from '../../scrape/ytsearch.js'
import { getBuffer, toAudio } from '../../src/utils/converter.js'
import { getRedis } from '../../src/database/redis.js'

const extractVideoId = (value = '') => {
    const text = String(value || '').trim()
    const match = text.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i)
    return match?.[1] || ''
}

const normalizeQuery = (value = '') =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')

const getCacheKey = ({ query, videoId, isUrl }) =>
    isUrl
        ? `play:audio:video:${videoId}`
        : `play:audio:query:${normalizeQuery(query)}`

const getCachedAudio = async (redis, key) => {
    if (!redis || !key) return null
    try {
        const raw = await redis.get(key)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed?.audioBase64) return null
        return parsed
    } catch {
        return null
    }
}

const setCachedAudio = async (redis, key, payload) => {
    if (!redis || !key || !payload?.audioBase64) return
    try {
        await redis.setEx(key, 60 * 60 * 24, JSON.stringify(payload))
    } catch {}
}

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
        let sourceId = ''

        if (!isUrl) {
            try {
                const res = await search(q, 1)
                if (!res || res.length === 0) {
                    return sock.sendMessage(jid, { text: `❌ Tidak ditemukan hasil untuk: ${q}` }, { quoted: msg })
                }
                metaFromSearch = res[0]
                url = res[0].url
                sourceId = String(res[0].id || extractVideoId(res[0].url)).trim()
            } catch {
                return sock.sendMessage(jid, { text: '❌ Gagal mencari video.' }, { quoted: msg })
            }
        }

        if (!sourceId) sourceId = extractVideoId(url)

        await react('⏳')

        try {
            const redis = await getRedis()
            const cacheKey = getCacheKey({
                isUrl,
                query: isUrl ? '' : q,
                videoId: sourceId
            })
            const cached = await getCachedAudio(redis, cacheKey)

            if (cached && String(cached.sourceId || '').trim() === sourceId) {
                const audio = Buffer.from(cached.audioBase64, 'base64')
                if (audio.length) {
                    await sock.sendMessage(jid, {
                        audio,
                        mimetype: 'audio/mpeg',
                        fileName: cached.fileName || `${cached.title || 'audio'}.mp3`,
                        ptt: false,
                        ...(cached.thumbnail || cached.sourceUrl ? {
                            contextInfo: {
                                externalAdReply: {
                                    title: cached.title || 'YouTube Audio',
                                    body: `${cached.channelName || '-'} • ${cached.duration || '-'}`,
                                    ...(cached.thumbnail ? { thumbnailUrl: cached.thumbnail } : {}),
                                    mediaUrl: cached.sourceUrl || url,
                                    sourceUrl: cached.sourceUrl || url,
                                    mediaType: 1,
                                    showAdAttribution: false,
                                    renderLargerThumbnail: true
                                }
                            }
                        } : {})
                    }, { quoted: msg })

                    useLimit()
                    await react('✅')
                    return
                }
            }

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

            await setCachedAudio(redis, cacheKey, {
                sourceId,
                title: String(res?.title || metaFromSearch?.title || 'YouTube Audio').trim(),
                channelName,
                duration: durasi,
                thumbnail: thumbUrl || String(metaFromSearch?.thumbnail || '').trim(),
                sourceUrl: url,
                fileName: `${res.title}.mp3`,
                audioBase64: audio.toString('base64')
            })

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

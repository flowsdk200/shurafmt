import axios from 'axios'
import { tiktok2, tiktok3, searchTikTok } from '../../scrape/tiktok.js'

const TIKTOK_REGEX = /https?:\/\/(vm\.|vt\.|www\.|m\.)?tiktok\.com\/[^\s]+/i

const toNum = (value) => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    const cleaned = String(value).replace(/[^0-9.-]/g, '')
    if (!cleaned) return undefined
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : undefined
}

const pickStat = (stats, keys = []) => {
    if (!stats || typeof stats !== 'object') return undefined
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(stats, key)) {
            const parsed = toNum(stats[key])
            if (parsed !== undefined) return parsed
        }
    }
    return undefined
}

const formatCaption = ({ title = '-', author = {} }) => {
    const authorLine = author?.username ? `@${author.username}` : (author?.nickname || '-')
    return (
        `\`Author: ${authorLine}\`

` +
        `${String(title || '-').trim() || '-'}`
    )
}
const fetchBuffer = async (url) => {
    const { data } = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    })
    return Buffer.from(data)
}

const isMissingValue = (value) => (
    value === undefined ||
    value === null ||
    value === '' ||
    value === '?'
)

const shouldBackfillMetadata = (result = {}) => {
    const authorUsername = result?.author?.username
    const stats = result?.stats || {}
    const duration = result?.type === 'video'
        ? (result?.video?.duration || result?.duration || result?.music?.duration)
        : undefined

    return (
        isMissingValue(authorUsername) ||
        isMissingValue(pickStat(stats, ['likes', 'like_count', 'digg_count'])) ||
        isMissingValue(pickStat(stats, ['comments', 'comment_count'])) ||
        isMissingValue(pickStat(stats, ['plays', 'play_count', 'views', 'view_count'])) ||
        isMissingValue(pickStat(stats, ['shares', 'share_count', 'shareCount'])) ||
        isMissingValue(pickStat(stats, [
            'saves',
            'saved',
            'collect_count',
            'collectCount',
            'collects',
            'collects_count',
            'saved_count',
            'save_count',
            'download_count',
            'downloadCount',
            'downloads'
        ])) ||
        (result?.type === 'video' && isMissingValue(duration))
    )
}

const mergePreferred = (primary = {}, fallback = {}) => {
    const mergedStats = {
        ...(fallback.stats || {}),
        ...(primary.stats || {})
    }

    const mergedAuthor = {
        ...(fallback.author || {}),
        ...(primary.author || {})
    }

    const mergedMusic = {
        ...(fallback.music || {}),
        ...(primary.music || {})
    }

    const mergedVideo = {
        ...(fallback.video || {}),
        ...(primary.video || {})
    }

    return {
        ...fallback,
        ...primary,
        description: primary.description || fallback.description || '',
        createTime: primary.createTime || fallback.createTime || '',
        author: Object.fromEntries(Object.entries(mergedAuthor).filter(([, v]) => !isMissingValue(v))),
        music: Object.fromEntries(Object.entries(mergedMusic).filter(([, v]) => !isMissingValue(v))),
        video: Object.fromEntries(Object.entries(mergedVideo).filter(([, v]) => !isMissingValue(v))),
        stats: Object.fromEntries(Object.entries(mergedStats).filter(([, v]) => !isMissingValue(v)))
    }
}

const pickBestMetadata = (primary = {}, fallback = {}) => {
    const primaryStats = primary?.stats || {}
    const fallbackStats = fallback?.stats || {}

    const hasPrimaryStats = !(
        isMissingValue(pickStat(primaryStats, ['likes', 'like_count', 'digg_count'])) &&
        isMissingValue(pickStat(primaryStats, ['comments', 'comment_count'])) &&
        isMissingValue(pickStat(primaryStats, ['plays', 'play_count', 'views', 'view_count'])) &&
        isMissingValue(pickStat(primaryStats, ['shares', 'share_count', 'shareCount'])) &&
        isMissingValue(pickStat(primaryStats, [
            'saves',
            'saved',
            'collect_count',
            'collectCount',
            'collects',
            'collects_count',
            'saved_count',
            'save_count',
            'download_count',
            'downloadCount',
            'downloads'
        ]))
    )

    const primaryDuration = primary?.duration || primary?.video?.duration || primary?.music?.duration
    const fallbackDuration = fallback?.duration || fallback?.video?.duration || fallback?.music?.duration

    return {
        title: primary?.description || fallback?.description || '',
        author: {
            id: primary?.author?.id || fallback?.author?.id || '',
            username: primary?.author?.username || fallback?.author?.username || '',
            nickname: primary?.author?.nickname || fallback?.author?.nickname || '-',
            avatar: primary?.author?.avatar || fallback?.author?.avatar || ''
        },
        stats: hasPrimaryStats ? primaryStats : fallbackStats,
        duration: primaryDuration || fallbackDuration || 0
    }
}

export default {
    name: 'tiktok',
    aliases: ['tt', 'tiktokdl', 'ttslide', 'tiktokslide', 'tiktoksearch', 'ttsearch'],
    description: 'Download/search tiktok via endpoint tiktok',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const isSearchCommand = ['tiktoksearch', 'ttsearch'].includes(String(command || '').toLowerCase())

        if (!text) {
            if (isSearchCommand) {
                return sock.sendMessage(jid, {
                    text: `❌ Masukkan kata pencarian tiktok.`
                }, { quoted: msg })
            }

            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://vt.tiktok.com/ZSu2kwRCQ/`
            }, { quoted: msg })
        }

        const urlMatch = text.match(TIKTOK_REGEX)

        if (isSearchCommand && urlMatch) {
            return sock.sendMessage(jid, {
                text: `❌ Command ${prefix + command} khusus pencarian tiktok, bukan link.\n\nContoh:\n${prefix + command} anime`
            }, { quoted: msg })
        }

        if (urlMatch && !isSearchCommand) {
            const url = urlMatch[0]
            await react('⏳')

            try {
                let result
                let fallbackMeta = null
                try {
                    result = await tiktok2(url)
                } catch {
                    result = await tiktok3(url)
                }

                if (shouldBackfillMetadata(result)) {
                    try {
                        fallbackMeta = await tiktok2(url)
                        result = mergePreferred(result, fallbackMeta)
                    } catch {}
                }

                const meta = pickBestMetadata(result, fallbackMeta || {})

                if (result.type === 'photo') {
                    const { images, music } = result
                    const caption = formatCaption({
                        type: 'photo',
                        title: meta.title,
                        author: meta.author,
                        stats: meta.stats
                    })

                    const mediaBuffers = await Promise.all(images.map((img) => fetchBuffer(img.url)))
                    const albumItems = mediaBuffers.map((buf, i) => ({
                        image: buf,
                        ...(i === 0 ? { caption } : {})
                    }))

                    await sock.sendMessage(jid, { albumMessage: albumItems }, { quoted: msg })

                    if (music?.url) {
                        const audioBuf = await fetchBuffer(music.url)
                        await sock.sendMessage(jid, {
                            audio: audioBuf,
                            mimetype: 'audio/mp4',
                            ptt: false
                        }, { quoted: msg })
                    }

                    useLimit()
                    await react('✅')
                    return
                }

                const { video } = result
                const caption = formatCaption({
                    type: 'video',
                    title: meta.title,
                    author: meta.author,
                    stats: meta.stats,
                    duration: meta.duration
                })

                const videoBuf = await fetchBuffer(video.url)
                await sock.sendMessage(jid, {
                    video: videoBuf,
                    caption,
                    mimetype: 'video/mp4'
                }, { quoted: msg })

                useLimit()
                await react('✅')
            } catch (err) {
                await react('❌')
                await sock.sendMessage(jid, {
                    text: `❌ Gagal mengunduh TikTok: ${err.message}`
                }, { quoted: msg })
            }
            return
        }

        await react('⏳')
        try {
            const results = await searchTikTok(text, 20)
            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ada hasil untuk: ${text}`
                }, { quoted: msg })
            }

            const valid = results.filter((r) => r.videoUrl)
            if (!valid.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Tidak ada video yang bisa diunduh dari hasil pencarian.'
                }, { quoted: msg })
            }

            const item = valid[Math.floor(Math.random() * valid.length)]
            const caption = formatCaption({
                type: 'search',
                title: item.title,
                author: item.author,
                stats: item.stats,
                duration: item.duration
            })

            const buf = await fetchBuffer(item.videoUrl)
            await sock.sendMessage(jid, {
                video: buf,
                caption,
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

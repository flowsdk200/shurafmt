import { getBuffer, toVideo } from '../../src/utils/converter.js'

const REQUEST_TIMEOUT = 30000
const USER_AGENT = 'Mozilla/5.0 (compatible; ShuraBot/1.0; +https://example.com/bot)'
const MAX_ALBUM = 10

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const cleanUrl = (value) => cleanText(value).replace(/&amp;/g, '&')

const requestText = async (url, options = {}) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            redirect: 'follow',
            signal: controller.signal
        })
        const body = await response.text()
        return {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body,
            url: response.url
        }
    } finally {
        clearTimeout(timer)
    }
}

const requestBuffer = async (url, options = {}) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            redirect: 'follow',
            signal: controller.signal
        })
        const arrayBuffer = await response.arrayBuffer()
        return {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            buffer: Buffer.from(arrayBuffer),
            url: response.url
        }
    } finally {
        clearTimeout(timer)
    }
}

const formatNumber = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n) || n < 0) return '0'
    if (n >= 1_000_000_000) return `${Number((n / 1_000_000_000).toFixed(1)).toString().replace(/\.0$/, '')}B`
    if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1)).toString().replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${Number((n / 1_000).toFixed(1)).toString().replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const normalizePostUrl = (url) => {
    try {
        const u = new URL(url)
        return `https://www.reddit.com${u.pathname}${u.search || ''}`
    } catch {
        return ''
    }
}

const pickPostId = (input) => {
    const text = cleanText(input)
    if (!text) return ''

    const directId = text.match(/^[a-z0-9]{5,10}$/i)?.[0]
    if (directId) return directId.toLowerCase()

    const prefixedId = text.match(/^t3_([a-z0-9]{5,10})$/i)?.[1]
    if (prefixedId) return prefixedId.toLowerCase()

    const commentPathId = text.match(/\/comments\/([a-z0-9]{5,10})(?:\/|$)/i)?.[1]
    if (commentPathId) return commentPathId.toLowerCase()

    const byId = text.match(/\/by_id\/t3_([a-z0-9]{5,10})(?:\.json|\/|$)/i)?.[1]
    if (byId) return byId.toLowerCase()

    return ''
}

const resolvePostId = async (input) => {
    const direct = pickPostId(input)
    if (direct) return direct

    const text = cleanText(input)
    if (!/^https?:\/\//i.test(text)) return ''

    const { statusCode, url } = await requestText(text, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (statusCode < 200 || statusCode >= 400) return ''
    return pickPostId(cleanText(url))
}

const pickPostFromJson = (parsed) => {
    const byId = parsed?.data?.children?.[0]?.data
    if (byId) return byId
    const listing = parsed?.[0]?.data?.children?.[0]?.data
    if (listing) return listing
    return null
}

const fetchPostData = async (postId) => {
    const urls = [
        `https://www.reddit.com/by_id/t3_${postId}.json?raw_json=1`,
        `https://old.reddit.com/comments/${postId}.json?raw_json=1`,
        `https://old.reddit.com/by_id/t3_${postId}.json?raw_json=1`
    ]

    for (const apiUrl of urls) {
        const { statusCode, body } = await requestText(apiUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json,text/plain,*/*',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        })

        if (statusCode !== 200) continue

        let parsed
        try {
            parsed = JSON.parse(String(body || '{}'))
        } catch {
            continue
        }

        const post = pickPostFromJson(parsed)
        if (post) return post
    }

    throw new Error('Post Reddit tidak ditemukan atau endpoint diblokir')
}

const pickVideoMeta = (post) => {
    const rv = post?.secure_media?.reddit_video
        || post?.media?.reddit_video
        || post?.preview?.reddit_video_preview
        || null

    const videoUrl = cleanText(rv?.fallback_url)
    if (!videoUrl) throw new Error('Post ini tidak punya video Reddit fallback')

    return {
        type: 'video',
        videoUrl,
        duration: Number(rv?.duration || 0),
        width: Number(rv?.width || 0),
        height: Number(rv?.height || 0)
    }
}

const pickGalleryMeta = (post) => {
    const items = Array.isArray(post?.gallery_data?.items) ? post.gallery_data.items : []
    const mediaMetadata = post?.media_metadata && typeof post.media_metadata === 'object'
        ? post.media_metadata
        : null

    if (!items.length || !mediaMetadata) return null

    const imageUrls = []
    for (const item of items) {
        const mediaId = cleanText(item?.media_id)
        if (!mediaId) continue
        const meta = mediaMetadata[mediaId]
        if (!meta || String(meta?.e || '').toLowerCase() !== 'image') continue
        const source = cleanUrl(meta?.s?.u)
        if (!source) continue
        if (!imageUrls.includes(source)) imageUrls.push(source)
    }

    if (!imageUrls.length) return null

    const firstMeta = mediaMetadata[cleanText(items?.[0]?.media_id)] || {}
    const width = Number(firstMeta?.s?.x || 0)
    const height = Number(firstMeta?.s?.y || 0)

    if (imageUrls.length === 1) {
        return { type: 'image', imageUrl: imageUrls[0], width, height }
    }

    return { type: 'album', imageUrls, width, height }
}

const pickImageMeta = (post) => {
    const direct = cleanUrl(post?.url_overridden_by_dest || post?.url)
    if (/^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)$/i.test(direct) || /^https?:\/\/i\.redd\.it\//i.test(direct)) {
        const width = Number(post?.preview?.images?.[0]?.source?.width || 0)
        const height = Number(post?.preview?.images?.[0]?.source?.height || 0)
        return { type: 'image', imageUrl: direct, width, height }
    }

    const previewSource = cleanUrl(post?.preview?.images?.[0]?.source?.url)
    if (previewSource) {
        const width = Number(post?.preview?.images?.[0]?.source?.width || 0)
        const height = Number(post?.preview?.images?.[0]?.source?.height || 0)
        return { type: 'image', imageUrl: previewSource, width, height }
    }

    const firstGalleryId = post?.gallery_data?.items?.[0]?.media_id
    const galleryMedia = firstGalleryId ? post?.media_metadata?.[firstGalleryId] : null
    const galleryUrl = cleanUrl(galleryMedia?.s?.u)
    if (galleryUrl) {
        const width = Number(galleryMedia?.s?.x || 0)
        const height = Number(galleryMedia?.s?.y || 0)
        return { type: 'image', imageUrl: galleryUrl, width, height }
    }

    return null
}

const pickMediaMeta = (post) => {
    if (post?.is_video) return pickVideoMeta(post)
    const gallery = pickGalleryMeta(post)
    if (gallery) return gallery
    const image = pickImageMeta(post)
    if (image) return image
    throw new Error('Post ini tidak punya media video/image yang didukung')
}

const validateMediaUrl = async (media) => {
    const targetUrl = media?.type === 'video'
        ? media.videoUrl
        : media?.type === 'album'
            ? media.imageUrls?.[0]
            : media.imageUrl
    const { statusCode, headers } = await requestText(targetUrl, {
        method: 'GET',
        headers: {
            'User-Agent': USER_AGENT,
            'Range': 'bytes=0-1'
        }
    })

    if (![200, 206].includes(statusCode)) {
        throw new Error(`Media URL tidak valid (HTTP ${statusCode})`)
    }

    const contentType = cleanText(headers?.['content-type']).toLowerCase()
    if (media?.type === 'video' && !contentType.includes('video/')) {
        throw new Error(`Content-Type video tidak valid: ${contentType || '-'}`)
    }
    if ((media?.type === 'image' || media?.type === 'album') && !contentType.includes('image/')) {
        throw new Error(`Content-Type image tidak valid: ${contentType || '-'}`)
    }
}

const formatDuration = (seconds) => {
    const total = Number(seconds || 0)
    if (!Number.isFinite(total) || total <= 0) return '-'
    const m = Math.floor(total / 60)
    const s = String(total % 60).padStart(2, '0')
    return `${m}:${s}`
}

const buildCaption = (post, media) => {
    const title = cleanText(post?.title) || '-'
    const subreddit = cleanText(post?.subreddit_name_prefixed || post?.subreddit) || '-'
    const author = cleanText(post?.author) || '-'
    const ups = formatNumber(post?.ups)
    const comments = formatNumber(post?.num_comments)
    const mediaType = media?.type === 'album' ? 'Album' : media?.type === 'image' ? 'Image' : 'Video'
    const durationLine = media?.type === 'video'
        ? `× Duration: ${formatDuration(media?.duration)}\n`
        : ''
    const resolution = media?.height && media?.width ? `${media.height}x${media.width}` : '-'
    const nsfw = post?.over_18 ? 'Yes' : 'No'
    const spoiler = post?.spoiler ? 'Yes' : 'No'
    const permalink = cleanText(post?.permalink)
    const postUrl = permalink ? `https://www.reddit.com${permalink}` : cleanText(post?.url || '-')

    return (
        `\`\`\`× Title: ${title}\n` +
        `× Subreddit: ${subreddit}\n` +
        `× Author: ${author}\n` +
        `× Upvotes: ${ups}\n` +
        `× Comments: ${comments}\n` +
        durationLine +
        `× NSFW: ${nsfw}\n` +
        `× Spoiler: ${spoiler}\`\`\``
    )
}

export default {
    name: 'redditdl',
    aliases: ['reddit', 'reddl'],
    description: 'Download video/image/album dari post reddit',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = cleanText(text)

        if (!input) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://www.reddit.com/r/nextfuckinglevel/comments/1rlgno4/the_most_insane_waterfall_ever_on_a_mountain`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const postId = await resolvePostId(input)
            if (!postId) throw new Error('❌ Link reddit tidak valid atau post tidak ditemukan')

            const post = await fetchPostData(postId)
            const media = pickMediaMeta(post)
            await validateMediaUrl(media)

            const caption = buildCaption(post, media)
            if (media.type === 'video') {
                const raw = await getBuffer(media.videoUrl, {
                    timeout: 120000,
                    maxRedirects: 5,
                    headers: { 'User-Agent': USER_AGENT }
                })
                const converted = await toVideo(raw, 'mp4')
                const video = converted?.data || converted

                await sock.sendMessage(jid, {
                    video,
                    mimetype: 'video/mp4',
                    caption
                }, { quoted: msg })
            } else if (media.type === 'image') {
                await sock.sendMessage(jid, {
                    image: { url: media.imageUrl },
                    caption
                }, { quoted: msg })
            } else {
                const buffers = []
                for (const url of media.imageUrls.slice(0, MAX_ALBUM)) {
                    try {
                        const fetched = await requestBuffer(url, {
                            method: 'GET',
                            headers: { 'User-Agent': USER_AGENT }
                        })
                        const ctype = cleanText(fetched?.headers?.['content-type']).toLowerCase()
                        if (!String(ctype).includes('image/')) continue
                        if (!Buffer.isBuffer(fetched?.buffer) || !fetched.buffer.length) continue
                        buffers.push(fetched.buffer)
                    } catch {
                        // ignore failed image in gallery
                    }
                }

                if (!buffers.length) throw new Error('Semua image gallery gagal diambil')

                const albumMessage = buffers.map((buf, i) => ({
                    image: buf,
                    ...(i === 0 ? { caption } : {})
                }))
                await sock.sendMessage(jid, { albumMessage }, { quoted: msg })
            }

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

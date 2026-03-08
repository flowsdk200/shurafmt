import { getBuffer, toVideo } from '../../src/utils/converter.js'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

const REQUEST_TIMEOUT = 30000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
const MAX_ALBUM = 10
const REDLIB_BASE = 'https://redlib.perennialte.ch'
const REDDIT_COOKIE = [
    'token_v2=eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpzS3dsMnlsV0VtMjVmcXhwTU40cWY4MXE2OWFFdWFyMnpLMUdhVGxjdWNZIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyIiwiZXhwIjoxNzczMDMxMjA0LjQ5ODA4NywiaWF0IjoxNzcyOTQ0ODA0LjQ5ODA4NywianRpIjoiUTBHNHZ0SWpONmxqOXVScVdiLXZKSUpLaFFyM21RIiwiY2lkIjoiMFItV0FNaHVvby1NeVEiLCJsaWQiOiJ0Ml8yOXF1MW1zcGNpIiwiYWlkIjoidDJfMjlxdTFtc3BjaSIsImF0IjoxLCJsY2EiOjE3NzI5NDQ3NjE2MzcsInNjcCI6ImVKeGtrZEdPdERBSWhkLUZhNV9nZjVVX20wMXRjWWFzTFFhb2szbjdEVm9jazcwN2NENHBIUDlES29xRkRDWlhncW5BQkZnVHJUREJSdVQ5bkxtM2cyaU5lOHRZc1puQ0JGbXdGRHJrbUxHc2lRUW1lSklheXhzbW9JTE55Rnl1dEdOTkxUMFFKcWhjTXJlRkhwYzJvYmtiaTU2ZEdGVzVyRHlvc1ZmbDB0akdGTFlueGpjYnF3MnB1QzZuTWtuTFF2a3NYdlRqTjlXMzl2bXpfU2EwSjhPS3F1bUIzaGxKQ0c0c2ZwaW0zZDlUazU2dEN4YTE5M3FRMnVkNjNLNTkxaXcwTzdlZjZfbHJJeG1YWTJoLUp2dDMxeS1oQTQ4OEx6UHFBRWFzNFVjWmRtUWRfbFVIVUxtZ0pHTUo0dE1JNU1ybDIzOEp0bXZUdjhidEV6OThNLUttTl96V0ROUnpDZUxRcF9IMUd3QUFfXzhRMWVUUiIsInJjaWQiOiJXdGpncUZDM0tySUlBaHN4QVIwRWFFNVVJMk5pUmRlTzExUGxDRFNtR2JBIiwiZmxvIjoyfQ.iHzxxz4YfWyor55ZXOWSpPH_sqyBTTXUGpnaYQvr8BvNVhRMO8B7kTZ1V1ukY7gv-rMEAlbw-rMI-oNeoqNhsn4emeZY-QE3rnIB6KjngC98VNvUfj-83iA09eFw4L7RIvbEPNTgOFeG5Dr6CzpUSgtCvqyijR-mxlIRvPl0_stAYqmLSLJlIUpN5g7EkXGO1PQh1pqsjGIgwBuo3HaNRnelg2suTbnJJgdnrp4Vtv9rWors-6z8lGmUf7JC8n_Xk0vP36STg55ib0CWakE9lk1ihwZa9qyLU2TICsEuZ2qNRQbCc4M2iFWlchoa0HShYfn5ngvqkoyVSuHt_44I8w',
    'csv=2',
    'rdt=fb229496c742fc39cd3a8a65fb21e4d3',
    'reddit_session=eyJhbGciOiJSUzI1NiIsImtpZCI6IlNIQTI1NjpsVFdYNlFVUEloWktaRG1rR0pVd1gvdWNFK01BSjBYRE12RU1kNzVxTXQ4IiwidHlwIjoiSldUIn0.eyJzdWIiOiJ0Ml8yOXF1MW1zcGNpIiwiZXhwIjoxNzg4NTgzMjA0LjAxNTE2NywiaWF0IjoxNzcyOTQ0ODA0LjAxNTE2NywianRpIjoiZUNnaXZ1dW03Sk9sSktJWlVKeUtNcmM5QXpSWkNBIiwiYXQiOjEsImNpZCI6ImNvb2tpZSIsImxjYSI6MTc3Mjk0NDc2MTYzNywic2NwIjoiZUp5S2pnVUVBQURfX3dFVkFMayIsImZsbyI6NywiYW1yIjpbInNzbyJdfQ.d1I66Afk0dcsDBS0ip1CqoKiROkZA1-YULpIEAFfxKdHSprQnK1u2kEjlYpYvdL94GBEWFdOj48-RQMN5clJD0dRaPa-YbkbiPasq3ZiQ4u0KQdBkhaQuY3lbwyjBhBOiT7fhudQRO6IkBCQMEgwkqMNJQDA25RnIc3gtDFiec5T6Xjs7h1MEJPqBRBvmlH0pDlcrefzmhurzLDTKTQ9yrwbI8X9H2bNiwaKcnG8b5TdJUk-2ZPSiYv8NYJFgZ1x6HRvx8sy4ZDHcFk2gZvYQkgZy-VV0ThiL9zCDq-AM8fbKt3B-NrWqUB5w5UaL2dHVuEW4ZLj9YuTgWLY-h-T1w',
    'edgebucket=ltotnI1I663LYuO7UF',
    'csrf_token=920b204d1343e227c42a664e5d392b2e',
    'loid=0000000029qu1mspci.2.1772944761637.Z0FBQUFBQnByUDE1UWpUM0l0YUhxdTVFQVZmZ2t0elE1MFZ6THllY0RpcUpqUXlMOEZZak51dWMyRFBJYUpORFJkM09NVVRaOHRTdmV3bkcxUTBoR0ZiRmRtaHNZcHlwNzVKTVZNOVlZcWZtTWxrNXR2UlZNR1dkU1JQMXc3ZGt4TVpTVlpqa3FKRzg'
].join('; ')
const BASE_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cookie': REDDIT_COOKIE,
    'Referer': 'https://www.reddit.com/',
    'Origin': 'https://www.reddit.com/'
}

const buildHeaders = (headers = {}) => ({ ...BASE_HEADERS, ...headers })

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const cleanUrl = (value) => cleanText(value).replace(/&amp;/g, '&')

const requestText = async (url, options = {}) => {
    try {
        const response = await axios({
            url,
            method: options.method || 'GET',
            headers: buildHeaders(options.headers || {}),
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 5,
            responseType: 'text',
            validateStatus: () => true
        })
        return {
            statusCode: response.status,
            headers: response.headers || {},
            body: String(response.data || ''),
            url: response.request?.res?.responseUrl || response.config?.url || url
        }
    } catch (err) {
        const detail = err?.code || err?.message || 'request text gagal'
        throw new Error(detail)
    }
}

const requestBuffer = async (url, options = {}) => {
    try {
        const response = await axios({
            url,
            method: options.method || 'GET',
            headers: buildHeaders(options.headers || {}),
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 5,
            responseType: 'arraybuffer',
            validateStatus: () => true
        })
        return {
            statusCode: response.status,
            headers: response.headers || {},
            buffer: Buffer.from(response.data || []),
            url: response.request?.res?.responseUrl || response.config?.url || url
        }
    } catch (err) {
        const detail = err?.code || err?.message || 'request buffer gagal'
        throw new Error(detail)
    }
}

const ensureAbsoluteUrl = (value, base = REDLIB_BASE) => {
    const text = cleanUrl(value)
    if (!text) return ''
    if (/^https?:\/\//i.test(text)) return text
    if (text.startsWith('//')) return `https:${text}`
    if (text.startsWith('/')) return `${base}${text}`
    return `${base}/${text}`
}

const decodeHtml = (value) => cleanText(value)
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const stripTags = (value) => decodeHtml(String(value || '').replace(/<[^>]+>/g, ' '))

const extractBetween = (html, startMarker, endMarker) => {
    const start = html.indexOf(startMarker)
    if (start === -1) return ''
    const from = start + startMarker.length
    const end = html.indexOf(endMarker, from)
    if (end === -1) return ''
    return html.slice(from, end)
}

const fetchRedlibMpdMedia = async (postId) => {
    const { statusCode, body } = await requestText(`https://www.redditmedia.com/mediaembed/${postId}?responsive=true`, {
        headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (statusCode !== 200) {
        throw new Error('Mediaembed Reddit tidak tersedia')
    }

    const mpdUrlRaw = body.match(/data-mpd-url="([^"]+)"/i)?.[1]
    if (!mpdUrlRaw) {
        throw new Error('MPD Reddit tidak ditemukan')
    }

    const mpdUrl = cleanUrl(mpdUrlRaw)
    const { statusCode: mpdStatus, body: mpdXml } = await requestText(mpdUrl, {
        headers: {
            Accept: 'application/dash+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: 'https://www.redditmedia.com/'
        }
    })

    if (mpdStatus !== 200) {
        throw new Error(`MPD Reddit gagal diambil (HTTP ${mpdStatus})`)
    }

    const videoBlock = extractBetween(mpdXml, '<AdaptationSet contentType="video"', '</AdaptationSet>')
    const audioBlock = extractBetween(mpdXml, '<AdaptationSet contentType="audio"', '</AdaptationSet>')

    const videoTracks = [...videoBlock.matchAll(/<Representation\b[^>]*height="(\d+)"[^>]*width="(\d+)"[^>]*>\s*<BaseURL>([^<]+)<\/BaseURL>/gi)]
        .map((m) => ({
            height: Number(m[1] || 0),
            width: Number(m[2] || 0),
            file: cleanText(m[3])
        }))
        .filter((item) => item.file)
        .sort((a, b) => b.height - a.height || b.width - a.width)

    const audioTrack = audioBlock.match(/<Representation\b[\s\S]*?<BaseURL>([^<]+)<\/BaseURL>/i)?.[1]

    if (!videoTracks.length || !audioTrack) {
        throw new Error('Track video/audio Reddit tidak ditemukan')
    }

    const mpd = new URL(mpdUrl)
    const basePath = mpd.pathname.replace(/[^/]+$/, '')
    const baseUrl = `${mpd.origin}${basePath}`
    const suffix = mpd.search || ''
    const selected = videoTracks[0]

    return {
        type: 'video',
        videoUrl: `${baseUrl}${selected.file}${suffix}`,
        audioUrl: `${baseUrl}${cleanText(audioTrack)}${suffix}`,
        width: selected.width,
        height: selected.height,
        duration: 0
    }
}

const fetchRedlibPostData = async (postId) => {
    const { statusCode, body } = await requestText(`${REDLIB_BASE}/comments/${postId}`, {
        headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (statusCode !== 200) {
        throw new Error('Post Redlib tidak ditemukan')
    }

    const title = stripTags(extractBetween(body, '<h1 class="post_title">', '</h1>')) || '-'
    const author = cleanText(body.match(/<meta name="author" content="([^"]+)"/i)?.[1] || '')
        .replace(/^u\//i, '')
    const ups = Number(body.match(/<div class="post_score" title="(\d+)"/i)?.[1] || 0)
    const numComments = Number(body.match(/id="comment_count">(\d+)\s+comments/i)?.[1] || 0)
    const ogUrl = cleanText(body.match(/<meta property="og:url" content="([^"]+)"/i)?.[1] || '')
    const redditUrl = body.match(/id="reddit_link" href="([^"]+)"/i)?.[1]
        || body.match(/href="(https:\/\/reddit\.com\/r\/[^"]+)"/i)?.[1]
        || ''
    const permalink = (ogUrl && /^\/r\/[^/]+\/comments\//i.test(ogUrl))
        ? ogUrl
        : redditUrl
            ? new URL(redditUrl).pathname
            : ogUrl || `/comments/${postId}`
    const subreddit = cleanText(permalink.match(/^\/r\/([^/]+)/i)?.[1] || '')

    const postMediaBlock = extractBetween(body, '<div class="post_media_content">', '</div>')
    const imageMatches = [...new Set(
        [...postMediaBlock.matchAll(/href="(\/img\/[^"]+)"/gi)]
            .map((m) => ensureAbsoluteUrl(m[1], REDLIB_BASE))
            .filter(Boolean)
    )]

    let media
    if (imageMatches.length > 1) {
        media = { type: 'album', imageUrls: imageMatches }
    } else if (imageMatches.length === 1) {
        media = { type: 'image', imageUrl: imageMatches[0], width: 0, height: 0 }
    } else if (postMediaBlock.includes('<video')) {
        media = await fetchRedlibMpdMedia(postId)
    } else {
        throw new Error('Post ini tidak punya media video/image yang didukung')
    }

    return {
        title,
        subreddit_name_prefixed: subreddit ? `r/${subreddit}` : '-',
        subreddit,
        author: author || '-',
        ups,
        num_comments: numComments,
        over_18: false,
        spoiler: false,
        permalink,
        __media: media
    }
}

const downloadChunked = async (url, headers = {}) => {
    const baseHeaders = buildHeaders({
        Accept: '*/*',
        Referer: 'https://www.redditmedia.com/',
        ...headers
    })

    const head = await axios({
        url,
        method: 'GET',
        headers: { ...baseHeaders, Range: 'bytes=0-0' },
        timeout: REQUEST_TIMEOUT,
        responseType: 'arraybuffer',
        validateStatus: () => true
    })

    const range = cleanText(head.headers?.['content-range'])
    const total = Number(range.match(/\/(\d+)$/)?.[1] || 0)
    if (![200, 206].includes(head.status) || !total) {
        throw new Error('Ukuran file Reddit tidak bisa dibaca')
    }

    const chunkSize = 512 * 1024
    const chunks = []
    for (let start = 0; start < total; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, total - 1)
        const response = await axios({
            url,
            method: 'GET',
            headers: { ...baseHeaders, Range: `bytes=${start}-${end}` },
            timeout: REQUEST_TIMEOUT,
            responseType: 'arraybuffer',
            validateStatus: () => true
        })

        if (![200, 206].includes(response.status)) {
            throw new Error(`Gagal download chunk Reddit (HTTP ${response.status})`)
        }

        chunks.push(Buffer.from(response.data || []))
    }

    return Buffer.concat(chunks)
}

const mergeVideoAudio = async (videoBuffer, audioBuffer) => {
    const tmpDir = path.join(process.cwd(), 'tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const videoFile = path.join(tmpDir, `${stamp}-video.mp4`)
    const audioFile = path.join(tmpDir, `${stamp}-audio.mp4`)
    const outFile = path.join(tmpDir, `${stamp}-out.mp4`)

    await fs.promises.writeFile(videoFile, videoBuffer)
    await fs.promises.writeFile(audioFile, audioBuffer)

    try {
        await new Promise((resolve, reject) => {
            spawn(ffmpegPath, [
                '-y',
                '-i', videoFile,
                '-i', audioFile,
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-shortest',
                outFile
            ])
                .on('error', reject)
                .on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)))
        })

        return await fs.promises.readFile(outFile)
    } finally {
        await Promise.allSettled([
            fs.promises.unlink(videoFile),
            fs.promises.unlink(audioFile),
            fs.promises.unlink(outFile)
        ])
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
        let response
        try {
            response = await requestText(apiUrl, {
                headers: {
                    'Accept': 'application/json,text/plain,*/*'
                }
            })
        } catch {
            continue
        }

        const { statusCode, body } = response

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

    return await fetchRedlibPostData(postId)
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
    if (post?.__media) return post.__media
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
                let video
                if (media.audioUrl) {
                    const [videoBuffer, audioBuffer] = await Promise.all([
                        downloadChunked(media.videoUrl),
                        downloadChunked(media.audioUrl)
                    ])
                    video = await mergeVideoAudio(videoBuffer, audioBuffer)
                } else {
                    const raw = await getBuffer(media.videoUrl, {
                        timeout: 120000,
                        maxRedirects: 5,
                        headers: buildHeaders({
                            'Accept': '*/*'
                        })
                    })
                    const converted = await toVideo(raw, 'mp4')
                    video = converted?.data || converted
                }

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
                            headers: {
                                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
                            }
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
            const detail = err?.message || err?.code || String(err) || 'Unknown error'
            await sock.sendMessage(jid, {
                text: `❌ Error: ${detail}`
            }, { quoted: msg })
        }
    }
}

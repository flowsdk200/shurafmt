const REQUEST_TIMEOUT = 30000
const MAX_ALBUM = 10

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const decodeHtml = (value) => cleanText(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const normalizeUrl = (value) => {
    const raw = decodeHtml(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (!/^https?:\/\//i.test(raw)) return ''
    return raw
}

const isTumblrUrl = (value) => {
    const raw = normalizeUrl(value)
    if (!raw) return false
    try {
        const u = new URL(raw)
        return /(^|\.)tumblr\.com$/i.test(u.hostname) || /(^|\.)tmblr\.co$/i.test(u.hostname)
    } catch {
        return false
    }
}

const requestText = async (url, headers = {}) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                ...headers
            },
            signal: controller.signal
        })
        const body = await response.text()
        return {
            statusCode: response.status,
            body: String(body || ''),
            finalUrl: response.url
        }
    } finally {
        clearTimeout(timer)
    }
}

const probeMedia = async (url) => {
    const target = normalizeUrl(url)
    if (!target) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
    try {
        const response = await fetch(target, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Range': 'bytes=0-2047'
            },
            signal: controller.signal
        })

        if (!(response.status === 200 || response.status === 206)) return null
        const mime = cleanText(response.headers.get('content-type') || '').toLowerCase()
        const finalUrl = cleanText(response.url || target)
        return { url: finalUrl, mime }
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

const extractInitialState = (html) => {
    const m = String(html || '').match(
        /<script[^>]*id=["']___INITIAL_STATE___["'][^>]*>([\s\S]*?)<\/script>/i
    )
    if (!m?.[1]) return null
    try {
        return JSON.parse(m[1])
    } catch {
        return null
    }
}

const extractMeta = (html, key) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const r = new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
        'i'
    )
    const m = String(html || '').match(r)
    return decodeHtml(m?.[1] || '')
}

const parsePostHint = (url) => {
    const out = { id: '', blog: '' }
    const raw = normalizeUrl(url)
    if (!raw) return out

    try {
        const u = new URL(raw)
        const parts = u.pathname.split('/').filter(Boolean)

        if (parts[0] && /^\d{8,}$/.test(parts[1] || '')) {
            out.blog = cleanText(parts[0]).toLowerCase()
            out.id = cleanText(parts[1])
            return out
        }

        if (parts[0] === 'blog' && parts[1] === 'view' && parts[2] && /^\d{8,}$/.test(parts[3] || '')) {
            out.blog = cleanText(parts[2]).toLowerCase()
            out.id = cleanText(parts[3])
            return out
        }

        const host = u.hostname.toLowerCase()
        const sub = host.match(/^([a-z0-9-]+)\.tumblr\.com$/i)?.[1] || ''
        if (sub) out.blog = sub.toLowerCase()

        if ((parts[0] === 'post' || parts[0] === 'video') && /^\d{8,}$/.test(parts[1] || '')) {
            out.id = cleanText(parts[1])
        }
    } catch {
        return out
    }

    return out
}

const collectPosts = (root) => {
    const posts = []
    const seen = new Set()

    const visit = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) {
            for (const item of node) visit(item)
            return
        }

        const id = cleanText(node.idString || node.id)
        const blogName = cleanText(node.blogName || node.blog?.name)
        const hasContent = Array.isArray(node.content)
        const hasUrl = cleanText(node.postUrl || node.canonicalUrl || node.url)
        if (id && blogName && hasContent && hasUrl) {
            const key = `${blogName}:${id}`
            if (!seen.has(key)) {
                seen.add(key)
                posts.push(node)
            }
        }

        for (const k of Object.keys(node)) visit(node[k])
    }

    visit(root)
    return posts
}

const pickPost = (posts, hint = { id: '', blog: '' }) => {
    if (!Array.isArray(posts) || !posts.length) return null

    if (hint.id) {
        const byId = posts.find((p) => cleanText(p.idString || p.id) === hint.id)
        if (byId) return byId
    }

    if (hint.blog) {
        const byBlog = posts.find((p) => cleanText(p.blogName || p.blog?.name).toLowerCase() === hint.blog)
        if (byBlog) return byBlog
    }

    return posts[0]
}

const looksLikeVideo = (url = '', mime = '') =>
    /^video\//i.test(mime) || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)

const looksLikeImage = (url = '', mime = '') =>
    /^image\//i.test(mime) || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)

const pushUnique = (arr, value) => {
    const url = normalizeUrl(value)
    if (!url) return
    if (!arr.includes(url)) arr.push(url)
}

const pickBestImageVariant = (mediaList = []) => {
    if (!Array.isArray(mediaList) || !mediaList.length) return ''
    let bestUrl = ''
    let bestArea = -1
    for (const media of mediaList) {
        const url = normalizeUrl(media?.url)
        if (!url) continue
        const w = Number(media?.width || media?.w || 0)
        const h = Number(media?.height || media?.h || 0)
        const area = w > 0 && h > 0 ? w * h : 0
        if (area > bestArea) {
            bestArea = area
            bestUrl = url
        }
        if (!bestUrl) bestUrl = url
    }
    return bestUrl
}

const canonicalImageKey = (value) => {
    const raw = normalizeUrl(value)
    if (!raw) return ''
    try {
        const u = new URL(raw)
        const host = u.hostname.toLowerCase().replace(/^www\./, '')
        if (/media\.tumblr\.com$/i.test(host)) {
            const parts = u.pathname.split('/').filter(Boolean)
            if (parts.length >= 2) {
                return `${host}/${parts[0]}/${parts[1]}`.toLowerCase()
            }
        }
        return `${host}${u.pathname}`.toLowerCase()
    } catch {
        return raw.toLowerCase()
    }
}

const extractMediaFromContent = (post) => {
    const blocks = Array.isArray(post?.content) ? post.content : []
    const videoCandidates = []
    const imageCandidates = []

    for (const block of blocks) {
        if (!block || typeof block !== 'object') continue

        const type = cleanText(block.type).toLowerCase()

        if (type === 'video') {
            pushUnique(videoCandidates, block.url)
            pushUnique(videoCandidates, block?.media?.url)
            if (Array.isArray(block?.media)) {
                for (const media of block.media) pushUnique(videoCandidates, media?.url)
            }
            if (Array.isArray(block?.streams)) {
                for (const stream of block.streams) pushUnique(videoCandidates, stream?.url)
            }
        }

        if (type === 'image' || type === 'photo') {
            if (Array.isArray(block?.media)) {
                const best = pickBestImageVariant(block.media)
                if (best) {
                    pushUnique(imageCandidates, best)
                } else {
                    pushUnique(imageCandidates, block.url)
                    pushUnique(imageCandidates, block?.media?.url)
                }
            } else {
                pushUnique(imageCandidates, block.url)
                pushUnique(imageCandidates, block?.media?.url)
            }
        }

        if (type === 'video' && Array.isArray(block?.poster)) {
            for (const poster of block.poster) pushUnique(imageCandidates, poster?.url)
        }
    }

    return { videoCandidates, imageCandidates }
}

const formatCompact = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n) || n < 0) return '0'
    if (n >= 1_000_000_000) return `${Number((n / 1_000_000_000).toFixed(1)).toString().replace(/\.0$/, '')}B`
    if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1)).toString().replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${Number((n / 1_000).toFixed(1)).toString().replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const pickTitleFromContent = (post) => {
    const blocks = Array.isArray(post?.content) ? post.content : []
    for (const block of blocks) {
        if (!block || typeof block !== 'object') continue
        if (cleanText(block.type).toLowerCase() !== 'text') continue
        const text = cleanText(block.text || block.title || block.heading)
        if (text) return text
    }
    return ''
}

const formatDate = (input) => {
    const n = Number(input)
    if (Number.isFinite(n) && n > 0) {
        const ms = n > 1e12 ? n : n * 1000
        return new Intl.DateTimeFormat('en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        }).format(new Date(ms))
    }
    const text = cleanText(input)
    if (!text) return '-'
    const d = new Date(text)
    if (Number.isNaN(d.getTime())) return text
    return new Intl.DateTimeFormat('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
    }).format(d)
}

const buildCaption = (meta) =>
    `\`\`\`× Title: ${meta.title}\n` +
    `× Blog: ${meta.blog}\n` +
    `× Posted: ${meta.date}\n` +
    `× Notes: ${meta.notes}\n` +
    `× Likes: ${meta.likes}\n` +
    `× Reblogs: ${meta.reblogs}\n` +
    `× Replies: ${meta.replies}\`\`\``

const resolveTumblr = async (input) => {
    const first = await requestText(input)
    if (first.statusCode < 200 || first.statusCode >= 400) {
        throw new Error(`Tumblr HTTP ${first.statusCode}`)
    }

    const finalUrl = first.finalUrl || input
    if (!isTumblrUrl(finalUrl)) throw new Error('Link harus dari tumblr.com')

    const state = extractInitialState(first.body)
    const hint = parsePostHint(finalUrl)
    const posts = collectPosts(state)
    const post = pickPost(posts, hint)

    if (!post) throw new Error('Post Tumblr tidak ditemukan')

    const { videoCandidates, imageCandidates } = extractMediaFromContent(post)

    const ogVideo = normalizeUrl(extractMeta(first.body, 'og:video'))
    const ogImage = normalizeUrl(extractMeta(first.body, 'og:image'))
    if (ogVideo) pushUnique(videoCandidates, ogVideo)
    if (ogImage) pushUnique(imageCandidates, ogImage)

    let video = null
    for (const candidate of videoCandidates) {
        const probed = await probeMedia(candidate)
        if (!probed) continue
        if (looksLikeVideo(probed.url, probed.mime)) {
            video = probed
            break
        }
    }

    const images = []
    const imageSeen = new Set()
    for (const candidate of imageCandidates) {
        if (images.length >= MAX_ALBUM) break
        const probed = await probeMedia(candidate)
        if (!probed) continue
        if (!looksLikeImage(probed.url, probed.mime)) continue
        const key = canonicalImageKey(probed.url)
        if (!key || imageSeen.has(key)) continue
        imageSeen.add(key)
        images.push(probed)
    }

    if (!video && !images.length) throw new Error('Media Tumblr tidak ditemukan')

    const blog = cleanText(post?.blogName || post?.blog?.name || hint.blog || '-') || '-'
    const id = cleanText(post?.idString || post?.id || hint.id || '-') || '-'
    const rawTitle = cleanText(
        post?.title ||
        post?.summary ||
        post?.slug ||
        pickTitleFromContent(post) ||
        extractMeta(first.body, 'og:title')
    )
    const title = rawTitle || (id !== '-' ? `Tumblr Post ${id}` : 'Untitled Tumblr Post')
    const link = normalizeUrl(post?.postUrl || post?.canonicalUrl || finalUrl) || finalUrl

    const meta = {
        title,
        blog: blog.startsWith('@') ? blog : `@${blog}`,
        id,
        type: video ? 'Video' : images.length > 1 ? 'Image Album' : 'Image',
        date: formatDate(post?.timestamp || post?.date),
        notes: formatCompact(post?.noteCount),
        likes: formatCompact(post?.likeCount),
        reblogs: formatCompact(post?.reblogCount),
        replies: formatCompact(post?.replyCount),
        link
    }

    return { meta, video, images }
}

export default {
    name: 'tumblr',
    aliases: ['tumblrdl', 'tumblrdownload'],
    description: 'Download video/gambar dari post tumblr',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = cleanText(text)

        if (!input) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} https://www.tumblr.com/cloudster-clown/809656362581852160`
            }, { quoted: msg })
        }

        if (!isTumblrUrl(input)) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari tumblr.com'
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const data = await resolveTumblr(input)
            const caption = buildCaption(data.meta)

            if (data.video?.url) {
                await sock.sendMessage(jid, {
                    video: { url: data.video.url },
                    caption,
                    mimetype: data.video.mime || 'video/mp4'
                }, { quoted: msg })
            } else if (data.images.length === 1) {
                await sock.sendMessage(jid, {
                    image: { url: data.images[0].url },
                    caption
                }, { quoted: msg })
            } else {
                const album = data.images.map((item, index) => ({
                    image: { url: item.url },
                    ...(index === 0 ? { caption } : {})
                }))
                await sock.sendMessage(jid, { albumMessage: album }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal Tumblr download: ${err?.message || 'Unknown error'}`
            }, { quoted: msg })
        }
    }
}

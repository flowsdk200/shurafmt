import axios from 'axios'

const SOURCE_URL = 'https://www.jawapos.com/'
const SOURCE_CANDIDATES = [
    'https://api.jawapos.com/',
    'https://www.jawapos.com/'
]
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const MAX_RESULTS = 15
const RECURSION_MAX_DEPTH = 5
const HTML_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: SOURCE_URL
}

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toNewsDate = (value) => {
    if (!value) return '-'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return cleanText(value)
    return parsed.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    })
}

const truncate = (text, max = 130) => {
    const value = cleanText(text)
    if (!value) return '-'
    return value.length > max ? `${value.slice(0, max)}...` : value
}

const toAbsoluteUrl = (href, baseUrl = SOURCE_URL) => {
    const value = cleanText(href)
    if (!value) return null
    try {
        return new URL(value, baseUrl).href
    } catch {
        return null
    }
}

const fetchHtml = async (url) => {
    try {
        const response = await axios.get(url, {
            timeout: 30000,
            responseType: 'text',
            validateStatus: () => true,
            headers: HTML_HEADERS
        })

        const html = String(response.data || '')
        console.log(`[JAWAPOS DEBUG] axios status=${response.status} url=${url} bytes=${html.length}`)
        if (response.status === 200 && html.trim()) {
            return { html, transport: 'axios', status: response.status }
        }
    } catch (err) {
        console.log(`[JAWAPOS DEBUG] axios failed url=${url} error=${err.message}`)
    }

    try {
        const response = await fetch(url, {
            headers: HTML_HEADERS
        })
        const html = await response.text()
        console.log(`[JAWAPOS DEBUG] fetch status=${response.status} url=${url} bytes=${html.length}`)
        if (response.status === 200 && html.trim()) {
            return { html, transport: 'fetch', status: response.status }
        }
    } catch (err) {
        console.log(`[JAWAPOS DEBUG] fetch failed url=${url} error=${err.message}`)
    }

    return { html: '', transport: 'none', status: 0 }
}

const extractNextData = (html) => {
    const text = String(html || '')

    const directMatch = text.match(/<script\b[^>]*\b(?:id|name)=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
    if (directMatch?.[1]) {
        try {
            const parsed = JSON.parse(directMatch[1])
            if (parsed?.props?.pageProps) return parsed
        } catch {
            // fallback below
        }
    }

    const scripts = text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)
    for (const [, raw] of scripts) {
        if (!raw) continue
        const snippet = raw.trim()
        if (!/"__NEXT_DATA__"/.test(snippet) && !/__NEXT_DATA__/i.test(snippet)) continue
        try {
            const parsed = JSON.parse(snippet)
            if (parsed?.props?.pageProps) return parsed
        } catch {
            // ignore malformed script payloads
        }
    }

    const windowMatch = text.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?/i)
    if (windowMatch?.[1]) {
        try {
            const parsed = JSON.parse(windowMatch[1])
            if (parsed?.props?.pageProps) return parsed
        } catch {
            // ignore malformed window payloads
        }
    }

    return null
}

const toAbsoluteImage = (image, article) => {
    if (!image) return null
    if (typeof image === 'string') return toAbsoluteUrl(image)
    if (typeof image !== 'object') return null
    return toAbsoluteUrl(
        image.url ||
        image.src ||
        image.path ||
        image.image ||
        image.photo ||
        image.thumbnail ||
        image.mainPhoto ||
        image.cover ||
        image.ogImage ||
        image.original,
        article?.imageBase || null
    )
}

const extractArticleImage = (article) => {
    if (!article || typeof article !== 'object') return null

    const candidateValues = [
        article.image,
        article.cover,
        article.thumbnail,
        article.heroImage,
        article.mainPhoto,
        article.photo,
        article.media,
        article.ogImage,
        article.imageUrl,
        article.image_url,
        article.urlImage
    ]

    for (const candidate of candidateValues) {
        const candidateUrl = toAbsoluteImage(candidate, article)
        if (candidateUrl) return candidateUrl
    }

    return null
}

const isArticleShape = (value) => {
    if (!value || typeof value !== 'object') return false
    const title = cleanText(value.title)
    const slug = cleanText(value.slug)
    const articleId = cleanText(value.article_id || value.id)
    const hasArticleSignals = Boolean(
        value.published_at ||
        value.description ||
        value.category ||
        value.content ||
        value.image ||
        value.cover
    )
    return title && slug && articleId && hasArticleSignals
}

const collectArticleCandidates = (pageProps) => {
    const candidates = []
    const visited = new Set()

    const walk = (node, depth = 0) => {
        if (!node || typeof node !== 'object' || visited.has(node) || depth > RECURSION_MAX_DEPTH) return
        visited.add(node)

        if (Array.isArray(node)) {
            for (const item of node) walk(item, depth + 1)
            return
        }

        if (isArticleShape(node)) {
            candidates.push(node)
            return
        }

        for (const value of Object.values(node)) {
            if (value && typeof value === 'object') {
                walk(value, depth + 1)
            }
        }
    }

    walk(pageProps)
    return candidates
}

const buildArticleLink = (article) => {
    const categorySlug = cleanText(article?.category?.slug)
    const articleId = cleanText(article?.article_id || article?.id)
    const slug = cleanText(article?.slug)
    if (!articleId || !slug) return null
    if (categorySlug) {
        return `https://www.jawapos.com/${categorySlug}/${articleId}/${slug}`
    }
    return `https://www.jawapos.com/${articleId}/${slug}`
}

const normalizeArticle = (article) => {
    if (!article || typeof article !== 'object') return null
    const title = cleanText(article.title)
    const link = buildArticleLink(article)
    const image = cleanText(extractArticleImage(article))
    if (!title || !link) return null

    return {
        articleId: cleanText(article.article_id || article.id || link),
        title,
        link,
        pubDate: cleanText(article.published_at),
        description: cleanText(article.description) || '-',
        image
    }
}

const fetchHomeItems = async () => {
    for (const sourceUrl of SOURCE_CANDIDATES) {
        const response = await fetchHtml(sourceUrl)
        console.log(`[JAWAPOS DEBUG] home transport=${response.transport} status=${response.status} url=${sourceUrl} bytes=${response.html.length}`)
        if (response.status !== 200 || !response.html.trim()) continue

        const nextData = extractNextData(response.html)
        if (!nextData?.props?.pageProps) {
            console.log(`[JAWAPOS DEBUG] nextdata missing url=${sourceUrl}`)
            continue
        }

        const pageProps = nextData.props.pageProps
        const buckets = [
            ...(Array.isArray(pageProps.headlines) ? pageProps.headlines.map((item) => item?.article) : []),
            ...(Array.isArray(pageProps.editorChoice) ? pageProps.editorChoice.map((item) => item?.article) : []),
            ...(Array.isArray(pageProps.latestNewsLarge) ? pageProps.latestNewsLarge : []),
            ...(Array.isArray(pageProps.latestNewsSmall) ? pageProps.latestNewsSmall : []),
            ...(Array.isArray(pageProps.latestNews) ? pageProps.latestNews : []),
            ...(Array.isArray(pageProps.popularNews) ? pageProps.popularNews : [])
        ]

        const combinedCandidates = [...buckets, ...collectArticleCandidates(pageProps)]

        const items = []
        const seen = new Set()

        for (const rawArticle of combinedCandidates) {
            const article = normalizeArticle(rawArticle)
            if (!article) continue
            if (seen.has(article.articleId)) continue
            seen.add(article.articleId)
            items.push(article)
            if (items.length >= MAX_RESULTS) break
        }

        console.log(`[JAWAPOS DEBUG] nextdata items=${items.length} source=${sourceUrl}`)
        if (items.length) return items
    }

    return []
}

const fetchImageBuffer = async (url) => {
    if (!/^https?:\/\//i.test(cleanText(url))) return null
    try {
        const response = await axios.get(url, {
            timeout: 120000,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                Referer: 'https://www.jawapos.com/',
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
            }
        })

        const contentType = cleanText(response.headers?.['content-type']).toLowerCase()
        console.log(`[JAWAPOS DEBUG] image status=${response.status} type=${contentType || '-'} url=${url}`)
        if (response.status < 200 || response.status >= 400) return null
        if (!contentType.startsWith('image/')) return null

        const buffer = Buffer.from(response.data || [])
        console.log(`[JAWAPOS DEBUG] image bytes=${buffer.length} url=${url}`)
        return buffer.length ? buffer : null
    } catch {
        console.log(`[JAWAPOS DEBUG] image fetch failed url=${url}`)
        return null
    }
}

const formatItem = (item, index) => (
    `${index + 1}. ${item.title}\n` +
    `• Tanggal: ${toNewsDate(item.pubDate)}\n` +
    `• Link: ${item.link}`
)

export default {
    name: 'jawapos',
    aliases: ['jawa', 'jawa-news'],
    description: 'Jawa Pos News',
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid
        await react('⏳')

        try {
            const items = await fetchHomeItems()
            if (!items.length) {
                await react('❌')
                return sock.sendMessage(jid, { text: '⚠️ Tidak ada berita ditemukan dari Jawa Pos News.' }, { quoted: msg })
            }

            let firstImage = null
            for (const item of items) {
                if (!firstImage && item.image) {
                    firstImage = await fetchImageBuffer(item.image)
                    if (firstImage) break
                }
            }

            console.log(`[JAWAPOS DEBUG] items=${items.length} firstImage=${firstImage ? 'yes' : 'no'}`)

            const caption = `\`\`\`${items.map((item, index) => formatItem(item, index)).join('\n\n')}\`\`\``
            if (!firstImage) {
                await sock.sendMessage(jid, { text: `📰 Jawa Pos News\n\n${caption}` }, { quoted: msg })
                useLimit()
                await react('✅')
                return
            }

            await sock.sendMessage(jid, { image: firstImage, caption }, { quoted: msg })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal ambil berita Jawa Pos News: ${err.message}`
            }, { quoted: msg })
        }
    }
}

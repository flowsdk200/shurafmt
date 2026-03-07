import axios from 'axios'

const REQUEST_TIMEOUT = 30000
const MOBILE_BASE = 'https://m.youtube.com'
const REQUIRED_FIELDS = [
    'title',
    'channelId',
    'handle',
    'channelUrl',
    'avatar',
    'subscribers',
    'videos',
    'views',
    'joined'
]

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toSafe = (value, fallback = '[none]') => {
    const text = cleanText(value)
    return text || fallback
}

const getText = (node) => {
    if (!node) return ''
    if (typeof node === 'string') return cleanText(node)
    if (typeof node === 'number') return String(node)
    if (typeof node?.content === 'string') return cleanText(node.content)
    if (typeof node?.simpleText === 'string') return cleanText(node.simpleText)
    if (Array.isArray(node?.runs)) {
        const s = node.runs.map((x) => cleanText(x?.text)).filter(Boolean).join('')
        return cleanText(s)
    }
    if (typeof node?.accessibility?.accessibilityData?.label === 'string') {
        return cleanText(node.accessibility.accessibilityData.label)
    }
    return ''
}

const getBestThumbnail = (node) => {
    if (!node?.thumbnails || !Array.isArray(node.thumbnails) || !node.thumbnails.length) return ''
    const sorted = [...node.thumbnails]
        .filter((x) => cleanText(x?.url))
        .sort((a, b) => Number(a?.width || 0) - Number(b?.width || 0))
    return cleanText(sorted[sorted.length - 1]?.url || '')
}

const extractBalancedObject = (text, startIndex) => {
    let depth = 0
    let inString = false
    let quote = ''
    let escaped = false

    for (let i = startIndex; i < text.length; i += 1) {
        const ch = text[i]

        if (inString) {
            if (escaped) {
                escaped = false
                continue
            }
            if (ch === '\\') {
                escaped = true
                continue
            }
            if (ch === quote) {
                inString = false
                quote = ''
            }
            continue
        }

        if (ch === '"' || ch === '\'') {
            inString = true
            quote = ch
            continue
        }

        if (ch === '{') {
            depth += 1
        } else if (ch === '}') {
            depth -= 1
            if (depth === 0) {
                return text.slice(startIndex, i + 1)
            }
        }
    }

    return ''
}

const parseJsonObjectAfter = (raw, marker) => {
    const idx = raw.indexOf(marker)
    if (idx < 0) return null

    const objStart = raw.indexOf('{', idx + marker.length)
    if (objStart < 0) return null

    const objectText = extractBalancedObject(raw, objStart)
    if (!objectText) return null

    try {
        return JSON.parse(objectText)
    } catch {
        return null
    }
}

const parseYtInitialData = (raw) => {
    const markers = [
        'var ytInitialData = ',
        'window["ytInitialData"] = ',
        'ytInitialData = '
    ]

    for (const marker of markers) {
        const parsed = parseJsonObjectAfter(raw, marker)
        if (parsed) return parsed
    }

    return null
}

const findFirstObject = (root, predicate) => {
    const stack = [root]
    const seen = new Set()

    while (stack.length) {
        const cur = stack.pop()
        if (!cur || typeof cur !== 'object') continue
        if (seen.has(cur)) continue
        seen.add(cur)

        if (predicate(cur)) return cur

        if (Array.isArray(cur)) {
            for (let i = cur.length - 1; i >= 0; i -= 1) stack.push(cur[i])
        } else {
            for (const value of Object.values(cur)) stack.push(value)
        }
    }

    return null
}

const findTextByKey = (root, key) => {
    const obj = findFirstObject(root, (x) => Object.prototype.hasOwnProperty.call(x, key))
    if (!obj) return ''
    return getText(obj[key])
}

const normalizeTargetPath = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (!/(^|\.)youtube\.com$/i.test(u.hostname) && !/(^|\.)youtu\.be$/i.test(u.hostname)) return ''

            const parts = u.pathname.split('/').filter(Boolean)
            if (!parts.length) return ''

            if (parts[0].startsWith('@')) return `/${parts[0]}`
            if (parts[0] === 'channel' && parts[1]) return `/channel/${parts[1]}`
            if (parts[0] === 'user' && parts[1]) return `/user/${parts[1]}`
            if (parts[0] === 'c' && parts[1]) return `/c/${parts[1]}`
            return `/${parts[0]}`
        } catch {
            return ''
        }
    }

    if (raw.startsWith('@')) {
        const compactHandle = raw.replace(/\s+/g, '').replace(/^@+/, '')
        if (!compactHandle) return ''
        return `/@${compactHandle}`
    }
    if (/^UC[A-Za-z0-9_-]{20,}$/.test(raw)) return `/channel/${raw}`

    const compact = raw.replace(/\s+/g, '')
    const sanitized = compact.replace(/^@+/, '').replace(/[^A-Za-z0-9_.-]/g, '')
    if (!sanitized) return ''
    return `/@${sanitized}`
}

const buildAboutUrl = (targetPath) => {
    const base = targetPath.endsWith('/') ? targetPath.slice(0, -1) : targetPath
    if (base.endsWith('/about')) return `${MOBILE_BASE}${base}`
    return `${MOBILE_BASE}${base}/about`
}

const parseStrictMetadata = (html, initialData, requestedUrl) => {
    const channelMetaObj = findFirstObject(initialData, (x) => !!x.channelMetadataRenderer)
    const headerObj = findFirstObject(initialData, (x) => !!x.c4TabbedHeaderRenderer)
    const microObj = findFirstObject(initialData, (x) => !!x.microformatDataRenderer)
    const aboutObj = findFirstObject(initialData, (x) => !!x.aboutChannelViewModel)

    const channelMeta = channelMetaObj?.channelMetadataRenderer || {}
    const header = headerObj?.c4TabbedHeaderRenderer || {}
    const micro = microObj?.microformatDataRenderer || {}
    const about = aboutObj?.aboutChannelViewModel || {}

    const title = cleanText(channelMeta?.title || getText(header?.title))
    const channelId = cleanText(channelMeta?.externalId || micro?.externalChannelId || about?.channelId)
    const channelUrl = cleanText(channelMeta?.channelUrl || micro?.urlCanonical)

    const vanity = cleanText(channelMeta?.vanityChannelUrl || '')
    const handleFromVanity = vanity.match(/\/(@[A-Za-z0-9_.-]+)/)?.[1] || ''
    const handleFromHeader = getText(header?.channelHandleText)
    const handle = cleanText(handleFromVanity || handleFromHeader).replace(/^@+/, '@')

    const avatar = cleanText(
        getBestThumbnail(channelMeta?.avatar) ||
        getBestThumbnail(header?.avatar) ||
        getBestThumbnail(header?.channelThumbnailWithLinkRenderer?.thumbnail)
    )

    const banner = cleanText(getBestThumbnail(header?.banner) || getBestThumbnail(header?.mobileBanner?.thumbnail))
    const subscribers = cleanText(
        getText(about?.subscriberCountText) ||
        getText(header?.subscriberCountText) ||
        findTextByKey(initialData, 'subscriberCountText')
    )
    const videos = cleanText(
        getText(about?.videoCountText) ||
        getText(header?.videosCountText) ||
        findTextByKey(initialData, 'videosCountText') ||
        findTextByKey(initialData, 'videoCountText')
    )
    const views = cleanText(
        getText(about?.viewCountText) ||
        findTextByKey(initialData, 'viewCountText')
    )
    const joined = cleanText(
        getText(about?.joinedDateText) ||
        findTextByKey(initialData, 'joinedDateText')
    )

    const description = cleanText(about?.description || channelMeta?.description || micro?.description || '')
    const country = cleanText(getText(about?.country) || findTextByKey(initialData, 'country') || '')
    const keywords = cleanText(channelMeta?.keywords || '')
    const canonical = cleanText(micro?.urlCanonical || channelUrl)
    const isFamilySafe = micro?.isFamilySafe === true ? 'Yes' : micro?.isFamilySafe === false ? 'No' : '[none]'

    const meta = {
        title,
        channelId,
        handle,
        channelUrl,
        avatar,
        banner,
        subscribers,
        videos,
        views,
        joined,
        description: description || '[empty]',
        country: country || '[none]',
        keywords: keywords || '[none]',
        canonical: canonical || '[none]',
        isFamilySafe,
        source: requestedUrl
    }

    for (const key of REQUIRED_FIELDS) {
        if (!cleanText(meta[key])) throw new Error(`Metadata tidak lengkap: ${key}`)
    }

    if (!initialData || typeof initialData !== 'object') {
        throw new Error('ytInitialData tidak valid')
    }

    if (!html || !cleanText(html)) {
        throw new Error('HTML channel kosong')
    }

    return meta
}

const fetchYoutubeProfile = async (aboutUrl) => {
    const { data, status } = await axios.get(aboutUrl, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'text/html,application/xhtml+xml'
        },
        validateStatus: () => true
    })

    if (status !== 200) throw new Error(`YouTube HTTP ${status}`)
    const html = String(data || '')
    if (!html) throw new Error('Respons YouTube kosong')

    const initialData = parseYtInitialData(html)
    if (!initialData) throw new Error('Gagal parse ytInitialData')

    return parseStrictMetadata(html, initialData, aboutUrl)
}

const buildCaption = (m) => ([
    `\`\`\`YOUTUBE STALK ${m.title.toUpperCase()}`,
    '',
    `× Handle: ${m.handle}`,
    `× Channel ID: ${m.channelId}`,
    `× Subscribers: ${m.subscribers}`,
    `× Videos: ${m.videos}`,
    `× Views: ${m.views}`,
    `× Joined: ${m.joined}`,
    `× Country: ${toSafe(m.country)}`,
    `× Family Safe: ${toSafe(m.isFamilySafe)}`,
    `× Keywords: ${toSafe(m.keywords)}`,
    `× Banner: ${toSafe(m.banner)}`,
    `× Channel URL: ${m.channelUrl}`,
    `× Description: ${toSafe(m.description, '[empty]')}`,
    `× Source: ${m.source}\`\`\``
].join('\n'))

export default {
    name: 'youtubestalk',
    aliases: ['ytstalk', 'stalkyoutube', 'channelstalk', 'ytprofile'],
    description: 'Stalk metadata lengkap channel youtube (strict)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const targetPath = normalizeTargetPath(text)

        if (!targetPath) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} anthropic-ai`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const aboutUrl = buildAboutUrl(targetPath)
            const meta = await fetchYoutubeProfile(aboutUrl)
            const caption = buildCaption(meta)

            await sock.sendMessage(jid, {
                image: { url: meta.avatar },
                caption
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

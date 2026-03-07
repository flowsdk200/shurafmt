import axios from 'axios'

const REQUEST_TIMEOUT = 30000
const FACEBOOK_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com']
const FACEBOOK_CANONICAL_HOSTS = ['www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com']
const FACEBOOK_REDIRECT_RETRY_LIMIT = 8
const FACEBOOK_META_PROBE_PARAMS = [
    { __a: '1' },
    { __a: '1', __d: 'dis' },
    { __a: '1', __req: '1' }
]

const PRIMARY_USER_AGENT = 'Mozilla/5.0'
const FALLBACK_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const GRAPHQL_USER_AGENT = 'Mozilla/5.0'
const GRAPHQL_REQUIRED_FIELDS = ['name', 'id', 'username', 'profileUrl', 'avatar', 'bio']
const GRAPHQL_QUERY_NAMES = ['ProfileCometHeaderQuery', 'ProfileCometAboutAppSectionQuery', 'ProfileCometLoggedOutRootQuery']

let graphqlQueryIdCache = {
    ids: null,
    at: 0
}

const REQUIRED_FIELDS = ['name', 'id', 'username', 'profileUrl', 'avatar']

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const safeDecode = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    try {
        return decodeURIComponent(raw)
    } catch {
        return raw
    }
}

const toSafe = (value, fallback = 'Unknown') => {
    const text = cleanText(value)
    return text || fallback
}

const isPositiveNumericId = (value) => /^[1-9]\d*$/.test(cleanText(value))

const toCompact = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n)) return '0'
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const isLikelyNumericId = (value) => /^\d{1,}$/.test(cleanText(value))

const parseCompactCount = (value) => {
    const text = cleanText(value).toUpperCase().replace(/\s+/g, '')
    if (!text) return null

    const m = text.match(/^([0-9]+(?:[.,][0-9]+)?)([KMBT]?)$/)
    if (!m) {
        const n = Number(text.replace(/[^\d]/g, ''))
        return Number.isFinite(n) ? n : null
    }

    const numPart = m[1]
    const unit = m[2]
    const normalized = unit
        ? numPart.replace(/,/g, '.')
        : numPart.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(/,/g, '.')
    const base = Number(normalized)
    if (!Number.isFinite(base)) return null

    const multiplier = unit === 'K' ? 1_000 : unit === 'M' ? 1_000_000 : unit === 'B' ? 1_000_000_000 : unit === 'T' ? 1_000_000_000_000 : 1
    return Math.round(base * multiplier)
}

const decodeHtml = (text) => {
    return String(text || '')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
}

const extractMetaContent = (html, attr, name) => {
    const source = String(html || '')
    const reA = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i')
    const reB = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${name}["'][^>]*>`, 'i')
    const mA = source.match(reA)
    if (mA?.[1]) return decodeHtml(mA[1])
    const mB = source.match(reB)
    return decodeHtml(mB?.[1] || '')
}

const extractMetaUrl = (html, name) => {
    const source = String(html || '')
    const re = new RegExp(`<meta[^>]+${name}=["']([^"']*)["'][^>]*>`, 'i')
    const m = source.match(re)
    return decodeHtml(m?.[1] || '')
}

const extractPublicMetaBundle = (html) => {
    return {
        ogUrl: cleanText(extractMetaContent(html, 'property', 'og:url')),
        ogLocale: cleanText(extractMetaContent(html, 'property', 'og:locale')),
        ogImageAlt: cleanText(extractMetaContent(html, 'property', 'og:image:alt')),
        twitterCard: cleanText(extractMetaContent(html, 'name', 'twitter:card')),
        twitterSite: cleanText(extractMetaContent(html, 'name', 'twitter:site')),
        androidAppName: cleanText(extractMetaContent(html, 'property', 'al:android:app_name')),
        androidPackage: cleanText(extractMetaContent(html, 'property', 'al:android:package')),
        androidUrl: cleanText(extractMetaContent(html, 'property', 'al:android:url')),
        iosAppName: cleanText(extractMetaContent(html, 'property', 'al:ios:app_name')),
        iosStoreId: cleanText(extractMetaContent(html, 'property', 'al:ios:app_store_id')),
        iosUrl: cleanText(extractMetaContent(html, 'property', 'al:ios:url'))
    }
}

const buildFacebookProbeUrls = (url) => {
    const result = new Set()
    try {
        const parsed = new URL(url)
        if (parsed.searchParams.has('__a')) {
            return [parsed.toString()]
        }

        for (const query of FACEBOOK_META_PROBE_PARAMS) {
            const cloned = new URL(parsed.toString())
            Object.entries(query).forEach(([key, value]) => {
                cloned.searchParams.set(key, value)
            })
            result.add(cloned.toString())
        }
    } catch {
        return [url]
    }
    return [...result]
}

const extractCanonical = (html) => {
    const source = String(html || '')
    const m = source.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)
    return cleanText(m?.[1] || '')
}

const matchFromHtml = (html, re) => {
    const m = String(html || '').match(re)
    return cleanText(m?.[1] || '')
}

const extractIdFromHtml = (html, fallbackFromUrl = '') => {
    const idFromProfilePhp = matchFromHtml(html, /profile\.php\?[^"'` >]*\bid=([0-9]+)/i)
    if (isPositiveNumericId(idFromProfilePhp)) return idFromProfilePhp

    const idFromPath = matchFromHtml(fallbackFromUrl, /\/(?:page|people|profile|user|pages|group)\/[^/]+\/([0-9]+)/i)
    if (isPositiveNumericId(idFromPath)) return idFromPath

    const idFromMeta = matchFromHtml(html, /"(?:page_id|profile_id|profileOwner|actor_id|entity_id|profileOwnerId|user_id|profile_owner_id)"\s*:\s*"?([0-9]+)"?/i)
    if (isPositiveNumericId(idFromMeta)) return idFromMeta

    const idFromMetaFallback = matchFromHtml(html, /"?(?:userID|viewerID|fbid)"?\s*:\s*"?([1-9][0-9]*)"?/i)
    if (isPositiveNumericId(idFromMetaFallback)) return idFromMetaFallback

    const idFromEntity = matchFromHtml(html, /"(?:object_id|owner_id|ownerId|author_id|uid)"\s*:\s*([0-9]+)/i)
    if (isPositiveNumericId(idFromEntity)) return idFromEntity

    return ''
}

const extractIdFromAppLinks = (html) => {
    return (
        matchFromHtml(html, /fb:\/\/profile\/([0-9]+)/i) ||
        matchFromHtml(html, /fb:\/\/page\/([0-9]+)/i) ||
        matchFromHtml(html, /"profile_id"\s*:\s*"([0-9]+)"/i) ||
        ''
    )
}

const extractAvatarFromHtml = (html, profileId = '') => {
    const candidates = [
        extractMetaContent(html, 'property', 'og:image'),
        extractMetaContent(html, 'name', 'twitter:image'),
        extractMetaContent(html, 'property', 'twitter:image'),
        matchFromHtml(html, /"profile_pic_url"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i),
        matchFromHtml(html, /"profilePicture"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/i),
        matchFromHtml(html, /"picture"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/i),
        matchFromHtml(html, /"profile_pic_uri"\s*:\s*"([^"]+)"/i),
        matchFromHtml(html, /"image"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/i),
        matchFromHtml(html, /"avatar"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i),
        matchFromHtml(html, /"thumbnail"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"/i)
    ]

    const chosen = candidates.find(Boolean)
    if (chosen) return decodeHtml(chosen)

    if (Number.isFinite(Number(profileId)) && Number(profileId) > 0) {
        return `https://graph.facebook.com/${encodeURIComponent(profileId)}/picture?width=400&height=400`
    }

    return ''
}

const extractBestFallbackAvatar = (html, profileId = '', username = '') => {
    const direct = extractAvatarFromHtml(html, profileId)
    if (direct) return direct

    if (isLikelyNumericId(profileId)) {
        return `https://graph.facebook.com/${encodeURIComponent(profileId)}/picture?width=400&height=400`
    }

    const cleanUser = cleanText(username)
    if (cleanUser && cleanUser !== 'Unknown') {
        return `https://graph.facebook.com/${encodeURIComponent(cleanUser)}/picture?width=400&height=400`
    }

    return ''
}

const isLoginLikeUrl = (url) => {
    try {
        const u = new URL(url)
        const path = u.pathname.toLowerCase()
        if (path.includes('/login')) return true
        if (path.includes('/checkpoint')) return true
        if (path.includes('/reg/')) return true
        if (path.includes('/r.php')) return true
        if (u.searchParams.get('next')) return false
        return false
    } catch {
        return false
    }
}

const isLoginLikeHtml = (html) => {
    const source = cleanText(html).toLowerCase()
    if (!source) return false
    const hasLoginPath = source.includes('/login/?next=') || source.includes('/login.php?next=')
    const hasLoginForm = source.includes('id="login_form"') || source.includes('name="login"')
    const hasErrorTitle = source.includes('<title>error</title>')
    const browserBlocked = source.includes('facebook is not available on this browser')
    return hasErrorTitle || browserBlocked || (hasLoginPath && hasLoginForm)
}

const extractLoginRedirectTarget = (url, html) => {
    try {
        const u = new URL(url)
        const next = u.searchParams.get('next') || u.searchParams.get('next_url') || u.searchParams.get('next_uri')
        if (next) {
            const decoded = safeDecode(next)
            if (/^https?:\/\//i.test(decoded)) return decoded
            if (decoded.startsWith('/')) return `https://www.facebook.com${decoded}`
            return `https://www.facebook.com/${decoded}`
        }
    } catch {
        // ignore
    }

    const extracted = matchFromHtml(html, /next=([^"'&\s]+)/i)
    if (!extracted) return ''
    const decoded = safeDecode(extracted)
    if (decoded.startsWith('/')) return `https://www.facebook.com${decoded}`
    if (/^https?:\/\//i.test(decoded)) return decoded
    return ''
}

const buildCandidateProfileUrls = (target) => {
    const set = new Set()
    const raw = cleanText(target)
    if (!raw) return set

    const addForHost = (baseUrl) => {
        let sourceUrl = baseUrl
        if (!/^https?:\/\//i.test(baseUrl)) sourceUrl = `https://www.facebook.com/${baseUrl}`

        try {
            const parsed = new URL(sourceUrl)
            for (const host of FACEBOOK_CANONICAL_HOSTS) {
                const u = new URL(parsed.toString())
                u.hostname = host
                buildFacebookProbeUrls(u.toString()).forEach((candidate) => {
                    set.add(candidate)
                })
            }
        } catch {
            set.add(baseUrl)
        }
    }

    if (/^https?:\/\//i.test(raw)) {
        addForHost(raw)
    } else {
        const encoded = encodeURIComponent(raw).replace(/%2F/g, '/')
        addForHost(encoded)
        if (/^[0-9]+$/.test(raw)) {
            addForHost(`https://www.facebook.com/profile.php?id=${encodeURIComponent(raw)}`)
        }
    }

    return [...set]
}

const extractProfileIdFromUrl = (url) => {
    try {
        const parsed = new URL(url)
        const idFromQuery = parsed.searchParams.get('id')
        if (idFromQuery && /^\d{1,}$/.test(idFromQuery)) return idFromQuery
    } catch {
        // ignore
    }
    return ''
}

const extractUsernameFromUrl = (url) => {
    try {
        const u = new URL(url)
        const parts = u.pathname.split('/').filter(Boolean)
        if (!parts.length) return ''

        if (parts[0] === 'profile.php') {
            return matchFromHtml(url, /[?&]id=([^&]+)/)
        }

        if (parts[0] === 'pages' && parts[2]) return parts[2]
        if (parts[0] === 'people' && parts[2]) return parts[2]
        if (parts[0] === 'groups' && parts[1]) return parts[1]

        const last = parts[parts.length - 1]
        if (parts[0] === 'share' && parts[1]) {
            return parts[1]
        }

        if (/^[0-9]+$/.test(last)) {
            return parts.length > 1 ? parts[parts.length - 2] : ''
        }

        return last
    } catch {
        return ''
    }
}

const extractUsernameFromHtml = (html) => {
    const fromMeta = matchFromHtml(html, /"profile_pic_thumb"\s*:\s*"[^"]*\/([^/?#.]+)\?/i)
    if (fromMeta) return fromMeta

    const json = matchFromHtml(html, /"username"\s*:\s*"([A-Za-z0-9._-]{3,})"/i)
    if (json) return json

    return ''
}

const extractCountsFromText = (text) => {
    const src = cleanText(text).toLowerCase()
    const result = {
        followers: null,
        following: null,
        friends: null,
        likes: null,
        talkingAbout: null
    }

    const pushMatch = (pattern, key) => {
        const m = src.match(pattern)
        if (!m) return
        const num = parseCompactCount(m[1])
        if (num === null) return
        if (result[key] === null || num > result[key]) result[key] = num
    }

    pushMatch(/([0-9.,]+[KMBT]?)\s*(followers?|pengikut)/i, 'followers')
    pushMatch(/([0-9.,]+[KMBT]?)\s*(following|mengikuti)/i, 'following')
    pushMatch(/([0-9.,]+[KMBT]?)\s*(friends?|teman)/i, 'friends')
    pushMatch(/([0-9.,]+[KMBT]?)\s*(likes?|suka)/i, 'likes')
    pushMatch(/([0-9.,]+[KMBT]?)\s*(talking about this|membicarakan ini)/i, 'talkingAbout')

    return result
}

const extractJsonLd = (html) => {
    const source = String(html || '')
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    for (const m of source.matchAll(re)) {
        try {
            const raw = cleanText(m[1])
            if (!raw) continue
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && typeof item === 'object' && typeof item.name === 'string') return item
                }
            } else if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
                return parsed
            }
        } catch {
            continue
        }
    }
    return null
}

const normalizeInput = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (!FACEBOOK_HOSTS.includes(u.hostname.replace(/^www\./, 'www.facebook.com')) && !u.hostname.endsWith('facebook.com')) return ''
            return u.toString()
        } catch {
            return ''
        }
    }

    if (raw.startsWith('@')) return raw.replace(/^@+/, '')
    return raw
}

const extractCookieValue = (cookieHeader, name) => {
    const raw = cleanText(cookieHeader)
    if (!raw) return ''
    const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
    return cleanText(match?.[1] || '')
}

const collectCookieHeader = (setCookies = []) => {
    if (!Array.isArray(setCookies) || !setCookies.length) return ''
    return setCookies.map((row) => String(row || '').split(';')[0]).filter(Boolean).join('; ')
}

const normalizeCookieHeader = (cookieHeader = '') => {
    const fromEnv = cleanText(cookieHeader)
    if (!fromEnv) return ''
    return fromEnv
        .split(';')
        .map((part) => cleanText(part))
        .filter(Boolean)
        .join('; ')
}

const parseGraphqlPayload = (payload) => {
    if (payload && typeof payload === 'object') return payload
    const raw = cleanText(payload)
    if (!raw) return {}

    const stripped = raw.replace(/^for\s*\(\s*;;\s*\);\s*/i, '')
    try {
        return JSON.parse(stripped)
    } catch {
        const lines = stripped.split('\n').map((line) => line.trim()).filter(Boolean)
        for (const line of lines) {
            try {
                return JSON.parse(line)
            } catch {
                continue
            }
        }
    }
    return {}
}

const extractGraphqlError = (payload) => {
    const first = Array.isArray(payload?.errors) ? payload.errors[0] : null
    const msg = cleanText(first?.message || payload?.errorSummary || payload?.error || '')
    const code = cleanText(first?.code || '')
    if (msg) return code ? `${msg} (code ${code})` : msg
    return ''
}

const extractLsdToken = (html) => {
    return (
        matchFromHtml(html, /"LSD",\[\],\{"token":"([^"]+)"/i) ||
        matchFromHtml(html, /"lsd":"([^"]+)"/i) ||
        extractMetaContent(html, 'name', 'lsd') ||
        ''
    )
}

const extractScriptUrls = (html) => {
    const urls = []
    for (const m of String(html || '').matchAll(/<script[^>]+src="([^"]+)"/gi)) {
        const src = cleanText(m?.[1] || '')
        if (!src) continue
        try {
            const full = new URL(src, 'https://www.facebook.com').toString()
            if (!/\.js(\?|$)/i.test(full)) continue
            urls.push(full)
        } catch {
            continue
        }
    }
    return [...new Set(urls)]
}

const extractRelayOpIdFromBundle = (bundleText, operationName) => {
    const escaped = operationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`__d\\("${escaped}_facebookRelayOperation",\\[\\],\\(function\\(t,n,r,o,a,i\\)\\{a\\.exports="([0-9]{8,})"\\}\\),null\\)`)
    return matchFromHtml(bundleText, re)
}

const resolveGraphqlQueryIds = async (html, cookieHeader = '') => {
    const age = Date.now() - Number(graphqlQueryIdCache.at || 0)
    if (graphqlQueryIdCache.ids && age < 30 * 60 * 1000) return graphqlQueryIdCache.ids

    const urls = extractScriptUrls(html)
    if (!urls.length) throw new Error('Bundle JS Facebook tidak ditemukan untuk resolve GraphQL')

    const ids = {}
    for (const url of urls) {
        if (GRAPHQL_QUERY_NAMES.every((name) => cleanText(ids[name]))) break

        let js = ''
        try {
            const { data, status } = await axios.get(url, {
                timeout: REQUEST_TIMEOUT,
                headers: {
                    'user-agent': GRAPHQL_USER_AGENT,
                    accept: '*/*',
                    ...(cookieHeader ? { cookie: cookieHeader } : {})
                },
                validateStatus: () => true
            })
            if (status !== 200) continue
            js = String(data || '')
        } catch {
            continue
        }

        for (const queryName of GRAPHQL_QUERY_NAMES) {
            if (ids[queryName]) continue
            const opId = extractRelayOpIdFromBundle(js, queryName)
            if (opId) ids[queryName] = opId
        }
    }

    const missing = GRAPHQL_QUERY_NAMES.filter((name) => !cleanText(ids[name]))
    if (missing.length) {
        throw new Error(`Doc ID GraphQL tidak lengkap: ${missing.join(', ')}`)
    }

    graphqlQueryIdCache = {
        ids,
        at: Date.now()
    }
    return ids
}

const postGraphql = async ({ lsd, cookieHeader, actorId, docId, friendlyName, variables, referer }) => {
    const payload = new URLSearchParams({
        av: String(actorId),
        __user: String(actorId),
        __a: '1',
        dpr: '1',
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: friendlyName,
        variables: JSON.stringify(variables),
        server_timestamps: 'true',
        doc_id: String(docId),
        lsd: String(lsd || '')
    }).toString()

    const { data, status } = await axios.post('https://www.facebook.com/api/graphql/', payload, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'user-agent': GRAPHQL_USER_AGENT,
            'content-type': 'application/x-www-form-urlencoded',
            accept: '*/*',
            origin: 'https://www.facebook.com',
            referer: referer || 'https://www.facebook.com/',
            ...(lsd ? { 'x-fb-lsd': lsd } : {}),
            ...(cookieHeader ? { cookie: cookieHeader } : {})
        },
        validateStatus: () => true
    })

    const parsed = parseGraphqlPayload(data)
    if (status >= 400) {
        const reason = extractGraphqlError(parsed) || `HTTP ${status}`
        throw new Error(`GraphQL ${friendlyName} gagal: ${reason}`)
    }

    const err = extractGraphqlError(parsed)
    if (err) throw new Error(`GraphQL ${friendlyName} gagal: ${err}`)
    return parsed
}

const extractImageUrl = (value) => {
    if (!value) return ''
    if (typeof value === 'string') {
        return /^https?:\/\//i.test(value) ? value : ''
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const picked = extractImageUrl(item)
            if (picked) return picked
        }
        return ''
    }
    if (typeof value === 'object') {
        const candidates = [
            value.uri,
            value.url,
            value.src,
            value.image?.uri,
            value.image?.url,
            value.profile_picture?.uri,
            value.profile_picture?.url,
            value.profile_picture?.image?.uri
        ]
        for (const item of candidates) {
            const picked = extractImageUrl(item)
            if (picked) return picked
        }
    }
    return ''
}

const mergeFirst = (target, key, value, guard = null) => {
    if (target[key] !== null && target[key] !== undefined && cleanText(target[key]) !== '') return
    if (guard && !guard(value)) return
    if (typeof value === 'string') {
        const text = cleanText(value)
        if (!text) return
        target[key] = text
        return
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        target[key] = value
        return
    }
    if (typeof value === 'boolean') {
        target[key] = value
    }
}

const harvestGraphqlMeta = (input, target = null) => {
    const meta = target || {
        id: null,
        name: null,
        username: null,
        profileUrl: null,
        avatar: null,
        cover: null,
        bio: null,
        category: null,
        isVerified: null,
        followers: null,
        following: null,
        friends: null,
        likes: null
    }

    const walk = (node, parentKey = '') => {
        if (node === null || node === undefined) return

        if (Array.isArray(node)) {
            for (const item of node) walk(item, parentKey)
            return
        }

        if (typeof node !== 'object') return

        for (const [keyRaw, value] of Object.entries(node)) {
            const key = String(keyRaw || '')
            const k = key.toLowerCase()

            if (k === 'id') mergeFirst(meta, 'id', value, (v) => isPositiveNumericId(v))
            if (k === 'name') mergeFirst(meta, 'name', value)
            if (k === 'username' || k === 'vanity' || k === 'user_name') mergeFirst(meta, 'username', value)
            if (k === 'url' || k === 'profile_url' || k === 'profileurl') {
                mergeFirst(meta, 'profileUrl', value, (v) => /^https?:\/\/(?:www\.)?facebook\.com\//i.test(cleanText(v)))
            }
            if (k.includes('profile_picture') || k === 'profilepiclarge' || k === 'profilepic' || k === 'profile_photo') {
                const picked = extractImageUrl(value)
                if (picked) mergeFirst(meta, 'avatar', picked)
            }
            if (k.includes('cover_photo') || k === 'cover' || k === 'coverphoto') {
                const picked = extractImageUrl(value)
                if (picked) mergeFirst(meta, 'cover', picked)
            }
            if (k === 'biography' || k === 'bio' || k === 'about' || k === 'about_me' || k === 'abouttext') {
                mergeFirst(meta, 'bio', value)
            }
            if (k === 'is_verified' || k === 'isblueverified' || k === 'is_blue_verified' || k === 'verified') {
                mergeFirst(meta, 'isVerified', !!value)
            }
            if (k === 'category' || k === 'category_name' || k === 'profile_category') {
                if (typeof value === 'object' && value?.name) mergeFirst(meta, 'category', value.name)
                else mergeFirst(meta, 'category', value)
            }
            if (k.includes('followers') && typeof value === 'number') mergeFirst(meta, 'followers', value)
            if ((k.includes('following') || k.includes('subscriptions')) && typeof value === 'number') mergeFirst(meta, 'following', value)
            if (k.includes('friends') && typeof value === 'number') mergeFirst(meta, 'friends', value)
            if ((k.includes('likes') || k.includes('fan_count')) && typeof value === 'number') mergeFirst(meta, 'likes', value)

            walk(value, key)
        }
    }

    walk(input, '')
    return meta
}

const fetchFacebookProfileViaGraphql = async (target) => {
    const envCookie = normalizeCookieHeader(process.env.FB_COOKIE || process.env.FACEBOOK_COOKIE || '')
    const actorFromCookie = extractCookieValue(envCookie, 'c_user')
    const actorId = isPositiveNumericId(actorFromCookie) ? actorFromCookie : '0'

    const direct = target.startsWith('http')
        ? target
        : `https://www.facebook.com/${encodeURIComponent(target)}`

    const normalizedUrl = direct.includes('facebook.com') ? direct : `https://www.facebook.com/${direct.replace(/^\/+/, '')}`
    const resolved = await resolveFacebookUrl(normalizedUrl)
    const html = String(resolved.html || '')
    if (!cleanText(html)) throw new Error('HTML profil kosong')

    const lsd = extractLsdToken(html)
    if (!lsd) throw new Error('Token LSD tidak ditemukan')

    const pageUrl = extractCanonical(html) || resolved.url || normalizedUrl
    const userId =
        extractIdFromHtml(html, pageUrl) ||
        extractIdFromAppLinks(html) ||
        extractProfileIdFromUrl(pageUrl)

    if (!isPositiveNumericId(userId)) {
        throw new Error('User ID Facebook tidak ditemukan')
    }

    const queryIds = await resolveGraphqlQueryIds(html, envCookie)
    const headerVariables = {
        scale: 1,
        selectedID: String(userId),
        selectedSpaceType: 'profile',
        shouldUseFXIMProfilePicEditor: false,
        userID: String(userId)
    }
    const aboutVariables = {
        appSectionFeedKey: 'ProfileCometAppSectionFeed_timeline_nav_app_sections__about',
        collectionToken: '',
        pageID: String(userId),
        rawSectionToken: 'about',
        scale: 1,
        sectionToken: 'about',
        showReactions: true,
        userID: String(userId)
    }
    const loggedOutVariables = {
        collectionToken: '',
        scale: 1,
        userID: String(userId)
    }

    const [headerPayload, aboutPayload, loggedOutPayload] = await Promise.all([
        postGraphql({
            lsd,
            cookieHeader: envCookie,
            actorId,
            docId: queryIds.ProfileCometHeaderQuery,
            friendlyName: 'ProfileCometHeaderQuery',
            variables: headerVariables,
            referer: pageUrl
        }),
        postGraphql({
            lsd,
            cookieHeader: envCookie,
            actorId,
            docId: queryIds.ProfileCometAboutAppSectionQuery,
            friendlyName: 'ProfileCometAboutAppSectionQuery',
            variables: aboutVariables,
            referer: pageUrl
        }),
        postGraphql({
            lsd,
            cookieHeader: envCookie,
            actorId,
            docId: queryIds.ProfileCometLoggedOutRootQuery,
            friendlyName: 'ProfileCometLoggedOutRootQuery',
            variables: loggedOutVariables,
            referer: pageUrl
        })
    ])

    const meta = harvestGraphqlMeta(headerPayload)
    harvestGraphqlMeta(aboutPayload, meta)
    harvestGraphqlMeta(loggedOutPayload, meta)

    if (!meta.profileUrl) meta.profileUrl = extractMetaContent(html, 'property', 'og:url') || pageUrl
    if (!meta.avatar) meta.avatar = extractMetaContent(html, 'property', 'og:image')
    if (!meta.name) meta.name = extractMetaContent(html, 'property', 'og:title')
    if (!meta.bio) meta.bio = extractMetaContent(html, 'property', 'og:description')
    if (!meta.username) meta.username = extractUsernameFromUrl(meta.profileUrl || pageUrl)
    if (!meta.id) meta.id = String(userId)

    const counts = extractCountsFromText(meta.bio || '')
    if (!Number.isFinite(meta.likes) && Number.isFinite(counts.likes)) meta.likes = counts.likes
    if (!Number.isFinite(meta.followers) && Number.isFinite(counts.followers)) meta.followers = counts.followers

    const normalized = {
        name: cleanText(meta.name),
        id: cleanText(meta.id),
        username: cleanText(meta.username),
        profileUrl: cleanText(meta.profileUrl),
        avatar: cleanText(meta.avatar),
        cover: cleanText(meta.cover),
        bio: cleanText(meta.bio),
        category: cleanText(meta.category),
        isVerified: Boolean(meta.isVerified),
        followers: Number.isFinite(meta.followers) ? meta.followers : null,
        following: Number.isFinite(meta.following) ? meta.following : null,
        friends: Number.isFinite(meta.friends) ? meta.friends : null,
        likes: Number.isFinite(meta.likes) ? meta.likes : null
    }

    const missing = GRAPHQL_REQUIRED_FIELDS.filter((key) => {
        const value = normalized[key]
        if (typeof value === 'string') return !cleanText(value)
        if (typeof value === 'number') return !Number.isFinite(value)
        if (typeof value === 'boolean') return value === null || value === undefined
        return value === null || value === undefined
    })
    if (missing.length) {
        throw new Error(`Metadata GraphQL tidak lengkap: ${missing.join(', ')}`)
    }

    return normalized
}

const resolveWithProfile = async (url, headerProfile) => {
    let target = url
    for (let i = 0; i < FACEBOOK_REDIRECT_RETRY_LIMIT; i += 1) {
        const { status, headers, request, data } = await axios.get(target, {
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 0,
            headers: headerProfile,
            validateStatus: () => true
        })

        if (status >= 300 && status < 400 && headers?.location) {
            const next = new URL(headers.location, target).toString()
            target = next
            continue
        }

        const finalUrl = request?.res?.responseUrl || request?.url || target
        return {
            url: finalUrl,
            html: String(data || ''),
            status
        }
    }
    throw new Error('Redirect loops saat resolve Facebook URL')
}

const resolveFacebookUrl = async (url) => {
    const headerProfiles = [
        {
            'user-agent': PRIMARY_USER_AGENT,
            accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9'
        },
        {
            'user-agent': FALLBACK_USER_AGENT,
            referer: 'https://www.facebook.com/',
            accept: 'text/html,application/xhtml+xml'
        }
    ]

    let fallback = null
    for (const profile of headerProfiles) {
        try {
            const resolved = await resolveWithProfile(url, profile)
            if (!fallback) fallback = resolved

            if (!cleanText(resolved.html)) continue
            if (resolved.status === 404) continue
            if (isLoginLikeUrl(resolved.url) || isLoginLikeHtml(resolved.html)) continue

            return resolved
        } catch {
            continue
        }
    }

    if (fallback) return fallback
    throw new Error('Gagal resolve Facebook URL')
}

const fetchFacebookProfile = async (target) => {
    const direct = target.startsWith('http')
        ? target
        : `https://www.facebook.com/${encodeURIComponent(target)}`

    const normalized = direct.includes('/share/') ? direct : direct
    const normalizedUrl = normalized.includes('facebook.com') ? normalized : `https://www.facebook.com/${direct.replace(/^\/+/, '')}`

    const queue = buildCandidateProfileUrls(normalizedUrl)
    if (!queue.length) {
        throw new Error('Target profil tidak valid')
    }

    const visited = new Set()

    while (queue.length) {
        const targetUrl = queue.shift()
        if (visited.has(targetUrl)) continue
        visited.add(targetUrl)

        let resolvedUrl = ''
        let html = ''
        let status = 0
        try {
            const resolved = await resolveFacebookUrl(targetUrl)
            resolvedUrl = resolved.url
            html = resolved.html
            status = resolved.status
        } catch {
            continue
        }

        if (!cleanText(html)) continue
        if (status === 404) continue

        if (isLoginLikeUrl(resolvedUrl) || isLoginLikeHtml(html)) {
            const nextUrl = extractLoginRedirectTarget(resolvedUrl, html)
            if (nextUrl && !visited.has(nextUrl)) {
                queue.push(nextUrl)
                continue
            }
            continue
        }

        const pageUrl = extractCanonical(html) || resolvedUrl
        if (isLoginLikeUrl(pageUrl) || isLoginLikeHtml(html)) continue

        const jsonLd = extractJsonLd(html) || {}
        const ogTitle = extractMetaContent(html, 'property', 'og:title')
        const ogType = extractMetaContent(html, 'property', 'og:type')
        const ogDesc = extractMetaContent(html, 'property', 'og:description') || extractMetaContent(html, 'name', 'description')
        const publicMeta = extractPublicMetaBundle(html)
        const ldName = toSafe(jsonLd?.name)
        const ldDesc = decodeHtml(jsonLd?.description || '')

        const rawProfileId = toSafe(extractIdFromHtml(html, pageUrl) || extractIdFromAppLinks(html) || extractProfileIdFromUrl(pageUrl), '')

        const name = cleanText(ogTitle || jsonLd?.headline || ldName)
        const type = cleanText(ogType || jsonLd?.['@type']) || 'Facebook Profile'
        const description = cleanText(ldDesc || ogDesc)
        const username =
            extractUsernameFromUrl(pageUrl) ||
            extractUsernameFromHtml(html) ||
            extractUsernameFromHtml(jsonLd?.alternateName || '') ||
            cleanText(ogTitle ? ogTitle.split(' | ')[0] : '')

        const avatar = extractBestFallbackAvatar(html, rawProfileId, username || extractUsernameFromUrl(resolvedUrl))
        const counts = extractCountsFromText(`${ogDesc} ${ldDesc}`)

        const meta = {
            name,
            id: rawProfileId || toSafe(username, ''),
            username,
            profileUrl: pageUrl,
            type,
            avatar,
            description,
            locale: publicMeta.ogLocale,
            imageAlt: publicMeta.ogImageAlt,
            twitterSite: publicMeta.twitterSite,
            twitterCard: publicMeta.twitterCard,
            androidAppName: publicMeta.androidAppName,
            androidPackage: publicMeta.androidPackage,
            androidUrl: publicMeta.androidUrl,
            iosAppName: publicMeta.iosAppName,
            iosStoreId: publicMeta.iosStoreId,
            iosUrl: publicMeta.iosUrl,
            followers: Number.isFinite(counts.followers) ? counts.followers : null,
            following: Number.isFinite(counts.following) ? counts.following : null,
            friends: Number.isFinite(counts.friends) ? counts.friends : null,
            likes: Number.isFinite(counts.likes) ? counts.likes : null,
            talkingAbout: Number.isFinite(counts.talkingAbout) ? counts.talkingAbout : null
        }

        const finalMeta = {
            ...meta,
            source: pageUrl
        }

        for (const key of REQUIRED_FIELDS) {
            if (!cleanText(finalMeta[key])) throw new Error(`Metadata tidak lengkap: ${key}`)
        }

        return finalMeta
    }

    throw new Error('Metadata tidak lengkap: avatar')
}

const normalizeMetaForOutput = (meta) => {
    return {
        name: cleanText(meta?.name),
        id: cleanText(meta?.id),
        username: cleanText(meta?.username || extractUsernameFromUrl(meta?.profileUrl || meta?.source || '')),
        isVerified: typeof meta?.isVerified === 'boolean' ? meta.isVerified : null,
        followers: Number.isFinite(meta?.followers) ? Number(meta.followers) : null,
        following: Number.isFinite(meta?.following) ? Number(meta.following) : null,
        friends: Number.isFinite(meta?.friends) ? Number(meta.friends) : null,
        likes: Number.isFinite(meta?.likes) ? Number(meta.likes) : null,
        talkingAbout: Number.isFinite(meta?.talkingAbout) ? Number(meta.talkingAbout) : null,
        category: cleanText(meta?.category),
        bio: cleanText(meta?.bio || meta?.description),
        cover: cleanText(meta?.cover),
        locale: cleanText(meta?.locale),
        type: cleanText(meta?.type),
        profileUrl: cleanText(meta?.profileUrl || meta?.source),
        avatar: cleanText(meta?.avatar)
    }
}

const fetchFacebookProfileAuto = async (target) => {
    let graphErr = null
    try {
        const gql = await fetchFacebookProfileViaGraphql(target)
        return normalizeMetaForOutput(gql)
    } catch (err) {
        graphErr = err
    }

    const pub = await fetchFacebookProfile(target)
    const normalized = normalizeMetaForOutput(pub)
    for (const key of ['name', 'id', 'username', 'profileUrl', 'avatar', 'bio']) {
        if (!cleanText(normalized[key])) {
            throw new Error(`Metadata publik tidak lengkap: ${key}${graphErr ? ` | GraphQL: ${graphErr.message}` : ''}`)
        }
    }
    return normalized
}

const buildCaption = (m) => {
    const lines = [
        `× Name: ${m.name}`,
        `× ID: ${m.id}`,
        `× Username: @${m.username}`
    ]
    if (typeof m.isVerified === 'boolean') lines.push(`× Verified: ${m.isVerified ? 'yes' : 'no'}`)
    if (Number.isFinite(m.followers)) lines.push(`× Followers: ${toCompact(m.followers)}`)
    if (Number.isFinite(m.following)) lines.push(`× Following: ${toCompact(m.following)}`)
    if (Number.isFinite(m.friends)) lines.push(`× Friends: ${toCompact(m.friends)}`)
    if (Number.isFinite(m.likes)) lines.push(`× Likes: ${toCompact(m.likes)}`)
    if (Number.isFinite(m.talkingAbout)) lines.push(`× Talking About: ${toCompact(m.talkingAbout)}`)
    if (cleanText(m.category)) lines.push(`× Category: ${m.category}`)
    if (cleanText(m.locale)) lines.push(`× Locale: ${m.locale}`)
    if (cleanText(m.type)) lines.push(`× Type: ${m.type}`)
    lines.push(`× Bio: ${m.bio}`)
    if (cleanText(m.cover)) lines.push(`× Cover: ${m.cover}`)
    lines.push(`× Link: ${m.profileUrl}`)
    return `\`\`\`FACEBOOK STALK ${cleanText(m.name).toUpperCase()}\n\n${lines.join('\n')}\`\`\``
}

export default {
    name: 'fbstalk',
    aliases: ['fbstalk', 'facebookstalk', 'stalkfb', 'fbprofile'],
    description: 'Stalk metadata lengkap akun facebook (strict)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const target = normalizeInput(text)

        if (!target) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} zuck`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const meta = await fetchFacebookProfileAuto(target)
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

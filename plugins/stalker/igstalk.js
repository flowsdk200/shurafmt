import axios from 'axios'

const REQUEST_TIMEOUT = 30000
const IG_BASE = 'https://www.instagram.com'
const IG_WEB_PROFILE_API = `${IG_BASE}/api/v1/users/web_profile_info/`
const REQUIRED_FIELDS = [
    'id',
    'username',
    'full_name',
    'profile_pic_url_hd',
    'edge_followed_by',
    'edge_follow',
    'edge_owner_to_timeline_media'
]

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toSafe = (value, fallback = '[none]') => {
    if (value === null || value === undefined) return fallback
    const text = cleanText(value)
    return text || fallback
}

const toBool = (value) => (value === true ? 'yes' : 'no')

const toBoolOrUnknown = (value) => {
    if (value === true) return 'yes'
    if (value === false) return 'no'
    return 'unknown'
}

const toCompactNumber = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n)) return '0'
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const normalizeUsername = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    let username = raw
    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return ''
            const first = u.pathname.split('/').filter(Boolean)[0] || ''
            username = first
        } catch {
            return ''
        }
    }

    username = username.replace(/^@+/, '')
    username = username.split(/[/?#]/)[0]
    username = cleanText(username).replace(/\s+/g, '')
    username = username.replace(/[^A-Za-z0-9._]/g, '')
    if (!username) return ''
    return username
}

const buildProfileUrl = (username) => `${IG_BASE}/${encodeURIComponent(username)}/`

const collectCookieHeader = (setCookie = []) => {
    if (!Array.isArray(setCookie) || !setCookie.length) return ''
    return setCookie
        .map((row) => String(row || '').split(';')[0].trim())
        .filter(Boolean)
        .join('; ')
}

const extractCookieValue = (cookieHeader, name) => {
    const raw = cleanText(cookieHeader)
    if (!raw) return ''
    const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
    return cleanText(match?.[1] || '')
}

const decodeHtml = (text) => String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, '\'')
    .replace(/&#039;/g, '\'')
    .replace(/&#064;/g, '@')
    .replace(/&#x2022;/g, '•')

const parseCompactCount = (raw) => {
    const text = cleanText(raw).toUpperCase().replace(/,/g, '')
    const m = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?$/)
    if (!m) return Number.NaN
    const base = Number(m[1])
    if (!Number.isFinite(base)) return Number.NaN
    const unit = m[2] || ''
    const mult = unit === 'K' ? 1_000 : unit === 'M' ? 1_000_000 : unit === 'B' ? 1_000_000_000 : 1
    return Math.round(base * mult)
}

const extractMetaContent = (html, attr, key) => {
    const source = String(html || '')
    const reA = new RegExp(`<meta[^>]+${attr}="${key}"[^>]+content="([^"]*)"[^>]*>`, 'i')
    const reB = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}="${key}"[^>]*>`, 'i')
    const mA = source.match(reA)
    if (mA?.[1]) return decodeHtml(mA[1])
    const mB = source.match(reB)
    return decodeHtml(mB?.[1] || '')
}

const deriveAccountFlags = (user = {}) => {
    let business = typeof user?.is_business_account === 'boolean' ? user.is_business_account : null
    let professional = typeof user?.is_professional_account === 'boolean' ? user.is_professional_account : null
    let category = cleanText(user?.business_category_name || user?.category_name || '')
    const accountType = Number(user?.account_type)

    if (business === null || professional === null) {
        if (accountType === 2) {
            if (business === null) business = true
            if (professional === null) professional = true
            if (!category) category = 'Business'
        } else if (accountType === 3) {
            if (business === null) business = false
            if (professional === null) professional = true
            if (!category) category = 'Creator'
        } else if (accountType === 1) {
            if (business === null) business = false
            if (professional === null) professional = false
            if (!category) category = 'Personal'
        }
    }

    if (!category) category = 'General'
    return { business, professional, category }
}

const extractBioFromDescription = (metaDescription) => {
    const md = decodeHtml(metaDescription)
    const m = md.match(/on Instagram:\s*"([\s\S]*)"\s*$/i)
    if (m?.[1]) return cleanText(m[1])
    return ''
}

const extractExternalUrlFromBio = (bio) => {
    const raw = cleanText(bio)
    if (!raw) return ''
    const direct = raw.match(/https?:\/\/[^\s)"]+/i)?.[0]
    if (direct) return direct.replace(/[.,;!?]+$/, '')
    const domain = raw.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i)?.[0]
    if (!domain) return ''
    return `https://${domain.replace(/[.,;!?]+$/, '')}`
}

const extractUserFromFeedPayload = (payload = {}, username = '') => {
    const uname = cleanText(username).toLowerCase()
    const itemUser = Array.isArray(payload?.items)
        ? payload.items
            .map((x) => x?.user)
            .find((u) => cleanText(u?.username).toLowerCase() === uname)
        : null
    const rootUser = payload?.user
    const source = itemUser || rootUser
    if (!source || typeof source !== 'object') return null

    return {
        id: cleanText(source?.id || source?.pk || ''),
        username: cleanText(source?.username || ''),
        full_name: cleanText(source?.full_name || ''),
        is_private: typeof source?.is_private === 'boolean' ? source.is_private : null,
        is_verified: typeof source?.is_verified === 'boolean' ? source.is_verified : null,
        profile_pic_url: cleanText(source?.profile_pic_url || ''),
        account_type: Number.isFinite(Number(source?.account_type)) ? Number(source.account_type) : null
    }
}

const buildUserFromPublicHtml = (html, username, feedUser = null) => {
    const ogTitle = extractMetaContent(html, 'property', 'og:title')
    const ogDescription = extractMetaContent(html, 'property', 'og:description')
    const ogImage = extractMetaContent(html, 'property', 'og:image')
    const metaDescription = extractMetaContent(html, 'name', 'description')
    const countsSource = cleanText(ogDescription || metaDescription)
    const bioFromMeta = extractBioFromDescription(metaDescription)

    const idMatch = String(html || '').match(/"id":"([0-9]{5,})"/)
    const id = cleanText(feedUser?.id || idMatch?.[1] || '')

    const titleMatch = ogTitle.match(/^(.*?)\s*\(@([A-Za-z0-9._]+)\)/)
    const fullName = cleanText(feedUser?.full_name || titleMatch?.[1] || '')
    const usernameFromTitle = cleanText(feedUser?.username || titleMatch?.[2] || username)

    const countMatch = countsSource.match(/([\d.,]+[KMB]?)\s+Followers[^0-9A-Za-z]+([\d.,]+[KMB]?)\s+Following[^0-9A-Za-z]+([\d.,]+[KMB]?)\s+Posts/i)
    const followers = parseCompactCount(countMatch?.[1] || '')
    const following = parseCompactCount(countMatch?.[2] || '')
    const posts = parseCompactCount(countMatch?.[3] || '')
    const bio = cleanText(bioFromMeta)
    const external = extractExternalUrlFromBio(bio)
    const flags = deriveAccountFlags(feedUser || {})

    const user = {
        id,
        username: usernameFromTitle || username,
        full_name: fullName,
        profile_pic_url_hd: cleanText(feedUser?.profile_pic_url || ogImage),
        profile_pic_url: cleanText(feedUser?.profile_pic_url || ogImage),
        edge_followed_by: { count: followers },
        edge_follow: { count: following },
        edge_owner_to_timeline_media: { count: posts },
        is_private: typeof feedUser?.is_private === 'boolean' ? feedUser.is_private : null,
        is_verified: typeof feedUser?.is_verified === 'boolean' ? feedUser.is_verified : null,
        is_business_account: flags.business,
        is_professional_account: flags.professional,
        business_category_name: flags.category,
        category_name: flags.category,
        biography: bio || '[empty]',
        external_url: external || '[none]',
        account_type: Number.isFinite(Number(feedUser?.account_type)) ? Number(feedUser.account_type) : null
    }

    if (!cleanText(user.id)) throw new Error('Metadata tidak lengkap: id')
    if (!cleanText(user.username)) throw new Error('Metadata tidak lengkap: username')
    if (!cleanText(user.full_name)) throw new Error('Metadata tidak lengkap: full_name')
    if (!cleanText(user.profile_pic_url_hd)) throw new Error('Metadata tidak lengkap: profile_pic_url_hd')
    if (!Number.isFinite(Number(user.edge_followed_by?.count))) throw new Error('Metadata tidak lengkap: followers')
    if (!Number.isFinite(Number(user.edge_follow?.count))) throw new Error('Metadata tidak lengkap: following')
    if (!Number.isFinite(Number(user.edge_owner_to_timeline_media?.count))) throw new Error('Metadata tidak lengkap: posts')

    return user
}

const extractStrictUser = (payload) => {
    const user = payload?.data?.user
    if (!user || typeof user !== 'object') throw new Error('Data user Instagram tidak ditemukan')

    for (const field of REQUIRED_FIELDS) {
        const value = user[field]
        const invalid =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim()) ||
            (typeof value === 'number' && !Number.isFinite(value))
        if (invalid) throw new Error(`Metadata tidak lengkap: ${field}`)
    }

    if (!Number.isFinite(Number(user?.edge_followed_by?.count))) {
        throw new Error('Metadata tidak lengkap: followers')
    }
    if (!Number.isFinite(Number(user?.edge_follow?.count))) {
        throw new Error('Metadata tidak lengkap: following')
    }
    if (!Number.isFinite(Number(user?.edge_owner_to_timeline_media?.count))) {
        throw new Error('Metadata tidak lengkap: posts')
    }

    return user
}

const createSession = async (username) => {
    const profileUrl = buildProfileUrl(username)
    const { status, headers, data } = await axios.get(profileUrl, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'text/html,application/xhtml+xml'
        },
        validateStatus: () => true
    })

    if (status === 404) throw new Error('User Instagram tidak ditemukan')
    if (status !== 200) throw new Error(`Instagram profile HTTP ${status}`)

    const cookieHeader = collectCookieHeader(headers?.['set-cookie'])
    const csrfToken = extractCookieValue(cookieHeader, 'csrftoken')
    return {
        cookieHeader,
        csrfToken,
        profileUrl,
        html: String(data || '')
    }
}

const requestWebProfileInfo = async (username, session, apiBase = IG_WEB_PROFILE_API) => {
    const { data, status } = await axios.get(apiBase, {
        timeout: REQUEST_TIMEOUT,
        params: { username },
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'application/json',
            'x-ig-app-id': '936619743392459',
            'x-requested-with': 'XMLHttpRequest',
            referer: session?.profileUrl || buildProfileUrl(username),
            origin: IG_BASE,
            ...(session?.cookieHeader ? { cookie: session.cookieHeader } : {}),
            ...(session?.csrfToken ? { 'x-csrftoken': session.csrfToken } : {})
        },
        validateStatus: () => true
    })

    if (status === 404) throw new Error('User Instagram tidak ditemukan')
    if (status !== 200) {
        const message = cleanText(data?.message) || cleanText(data?.status) || `Instagram HTTP ${status}`
        throw new Error(message)
    }

    if (!data || typeof data !== 'object') throw new Error('Respons Instagram tidak valid')
    return data
}

const requestUserFeedInfo = async (username, session) => {
    const { data, status } = await axios.get(`${IG_BASE}/api/v1/feed/user/${encodeURIComponent(username)}/username/`, {
        timeout: REQUEST_TIMEOUT,
        params: { count: 12 },
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'application/json',
            'x-ig-app-id': '936619743392459',
            'x-requested-with': 'XMLHttpRequest',
            referer: session?.profileUrl || buildProfileUrl(username),
            origin: IG_BASE,
            ...(session?.cookieHeader ? { cookie: session.cookieHeader } : {}),
            ...(session?.csrfToken ? { 'x-csrftoken': session.csrfToken } : {})
        },
        validateStatus: () => true
    })

    if (status === 404) throw new Error('User Instagram tidak ditemukan')
    if (status !== 200) throw new Error(`Instagram feed HTTP ${status}`)
    if (!data || typeof data !== 'object') throw new Error('Respons feed Instagram tidak valid')
    return data
}

const fetchInstagramProfile = async (username) => {
    const session = await createSession(username)
    const endpoints = [
        IG_WEB_PROFILE_API,
        'https://i.instagram.com/api/v1/users/web_profile_info/'
    ]

    let lastErr = null
    for (const endpoint of endpoints) {
        try {
            const payload = await requestWebProfileInfo(username, session, endpoint)
            return extractStrictUser(payload)
        } catch (err) {
            lastErr = err
            if (/tidak ditemukan/i.test(cleanText(err?.message))) break
        }
    }

    let feedUser = null
    try {
        const feedPayload = await requestUserFeedInfo(username, session)
        feedUser = extractUserFromFeedPayload(feedPayload, username)
    } catch (feedErr) {
        if (!lastErr) lastErr = feedErr
    }

    try {
        return buildUserFromPublicHtml(session.html, username, feedUser)
    } catch (fallbackErr) {
        throw lastErr || fallbackErr || new Error('Gagal ambil data Instagram')
    }
}

const buildCaption = (u, source) => {
    const followers = Number(u?.edge_followed_by?.count || 0)
    const following = Number(u?.edge_follow?.count || 0)
    const posts = Number(u?.edge_owner_to_timeline_media?.count || 0)

    const flags = deriveAccountFlags(u)

    return (
        `\`\`\`INSTAGRAM STALK ${toSafe(u.full_name, u.username).toUpperCase()}\n\n` +
        `• Username: @${u.username}\n` +
        `• User ID: ${toSafe(u.id)}\n` +
        `• Followers: ${toCompactNumber(followers)}\n` +
        `• Following: ${toCompactNumber(following)}\n` +
        `• Posts: ${toCompactNumber(posts)}\n` +
        `• Verified: ${toBoolOrUnknown(u.is_verified)}\n` +
        `• Private: ${toBoolOrUnknown(u.is_private)}\n` +
        `• Business: ${toBoolOrUnknown(flags.business)}\n` +
        `• Professional: ${toBoolOrUnknown(flags.professional)}\n` +
        `• Category: ${toSafe(flags.category)}\n` +
        `• External URL: ${toSafe(u.external_url)}\n` +
        `• Bio: ${toSafe(u.biography, '[empty]')}\n` +
        `• Link: ${source}\`\`\``
    )
}

export default {
    name: 'igstalk',
    aliases: ['instagramstalk', 'igprofile', 'stalkig', 'igst'],
    description: 'Stalk metadata lengkap akun Instagram (strict)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const username = normalizeUsername(text)

        if (!username) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} claudeai`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const user = await fetchInstagramProfile(username)
            const source = buildProfileUrl(username)
            const imageUrl = cleanText(user?.profile_pic_url_hd || user?.profile_pic_url)
            if (!imageUrl) throw new Error('❌ Metadata tidak lengkap: profile_pic_url_hd')

            await sock.sendMessage(jid, {
                image: { url: imageUrl },
                caption: buildCaption(user, source)
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

import axios from 'axios'

const REQUEST_TIMEOUT = 30000
const PINTEREST_BASE = 'https://www.pinterest.com'
const REQUIRED_FIELDS = [
    'id',
    'username',
    'full_name',
    'follower_count',
    'following_count',
    'pin_count',
    'board_count',
    'image_xlarge_url',
    'created_at',
    'type'
]

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toSafe = (value, fallback = '[none]') => {
    if (value === null || value === undefined) return fallback
    const text = cleanText(value)
    return text || fallback
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

const toDate = (value) => {
    const raw = cleanText(value)
    if (!raw) return '[none]'
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
    })
}

const toBool = (value) => (value === true ? 'yes' : 'no')

const normalizeUsername = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    let username = raw
    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (!/(^|\.)pinterest\.com$/i.test(u.hostname)) return ''
            username = u.pathname.split('/').filter(Boolean)[0] || ''
        } catch {
            return ''
        }
    }

    username = username.replace(/^@+/, '')
    username = username.split(/[/?#]/)[0]
    username = cleanText(username).replace(/\s+/g, '')
    username = username.replace(/[^A-Za-z0-9_.-]/g, '')
    if (!username) return ''
    return username
}

const buildProfileUrl = (username) => `${PINTEREST_BASE}/${encodeURIComponent(username)}/`

const extractJsonByScriptId = (html, id) => {
    const re = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, 'i')
    const m = String(html || '').match(re)
    if (!m?.[1]) return null
    try {
        return JSON.parse(m[1])
    } catch {
        return null
    }
}

const assertStrict = (user) => {
    for (const field of REQUIRED_FIELDS) {
        const value = user?.[field]
        const invalid =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim()) ||
            (typeof value === 'number' && !Number.isFinite(value))
        if (invalid) throw new Error(`Metadata tidak lengkap: ${field}`)
    }
}

const pickUserFromState = (state, username) => {
    const wanted = cleanText(username).toLowerCase()
    const users = state?.users && typeof state.users === 'object' ? Object.values(state.users) : []

    const byUsers = users.find((x) => cleanText(x?.username).toLowerCase() === wanted)
    if (byUsers) return byUsers

    const userResource = state?.resources?.UserResource || {}
    for (const entry of Object.values(userResource)) {
        const data = entry?.data
        if (cleanText(data?.username).toLowerCase() === wanted) return data
    }

    const fallback = users.find((x) => cleanText(x?.username))
    if (fallback) return fallback

    for (const entry of Object.values(userResource)) {
        if (entry?.data) return entry.data
    }

    return null
}

const fetchPinterestProfile = async (username) => {
    const profileUrl = buildProfileUrl(username)
    const { data, status } = await axios.get(profileUrl, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'text/html,application/xhtml+xml'
        },
        validateStatus: () => true
    })

    if (status === 404) throw new Error('User Pinterest tidak ditemukan')
    if (status !== 200) throw new Error(`Pinterest HTTP ${status}`)

    const html = String(data || '')
    if (!html) throw new Error('Respons Pinterest kosong')

    const root = extractJsonByScriptId(html, '__PWS_INITIAL_PROPS__')
    if (!root || typeof root !== 'object') {
        throw new Error('Gagal parse __PWS_INITIAL_PROPS__')
    }

    const state = root?.initialReduxState
    if (!state || typeof state !== 'object') {
        throw new Error('initialReduxState tidak ditemukan')
    }

    const rawUser = pickUserFromState(state, username)
    if (!rawUser || typeof rawUser !== 'object') {
        throw new Error('Data user tidak ditemukan di state')
    }

    assertStrict(rawUser)

    return {
        id: cleanText(rawUser.id),
        username: cleanText(rawUser.username),
        fullName: cleanText(rawUser.full_name),
        type: cleanText(rawUser.type),
        about: cleanText(rawUser.about) || '[empty]',
        website: cleanText(rawUser.website_url || rawUser.domain_url) || '[none]',
        followers: Number(rawUser.follower_count),
        following: Number(rawUser.following_count),
        pins: Number(rawUser.pin_count),
        boards: Number(rawUser.board_count),
        image: cleanText(rawUser.image_xlarge_url || rawUser.image_medium_url),
        createdAt: cleanText(rawUser.created_at),
        privateProfile: rawUser.is_private_profile === true,
        indexed: rawUser.indexed === true,
        domainVerified: rawUser.domain_verified === true,
        verifiedMerchant: rawUser.is_verified_merchant === true,
        seoTitle: cleanText(rawUser.seo_title) || '[none]',
        seoDescription: cleanText(rawUser.seo_description) || '[none]',
        source: profileUrl
    }
}

const buildCaption = (m) => (
    `\`\`\`PINTEREST STALK ${m.fullName.toUpperCase()}\n\n` +
    `• Username: ${m.username}\n` +
    `• User ID: ${m.id}\n` +
    `• Type: ${m.type}\n` +
    `• Followers: ${toCompactNumber(m.followers)}\n` +
    `• Following: ${toCompactNumber(m.following)}\n` +
    `• Pins: ${toCompactNumber(m.pins)}\n` +
    `• Boards: ${toCompactNumber(m.boards)}\n` +
    `• Created: ${toDate(m.createdAt)}\n` +
    `• Private: ${toBool(m.privateProfile)}\n` +
    `• Indexed: ${toBool(m.indexed)}\n` +
    `• Domain Verified: ${toBool(m.domainVerified)}\n` +
    `• Verified Merchant: ${toBool(m.verifiedMerchant)}\n` +
    `• Website: ${toSafe(m.website)}\n` +
    `• About: ${toSafe(m.about, '[empty]')}\n` +
    `• Link: ${m.source}\`\`\``
)

export default {
    name: 'pinstalk',
    aliases: ['pintereststalk', 'pinst', 'stalkpin', 'pinprofile'],
    description: 'Stalk metadata lengkap akun Pinterest (strict)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const username = normalizeUsername(text)

        if (!username) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} rnia17808`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const meta = await fetchPinterestProfile(username)
            const caption = buildCaption(meta)

            await sock.sendMessage(jid, {
                image: { url: meta.image },
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

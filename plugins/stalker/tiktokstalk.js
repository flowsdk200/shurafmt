import axios from 'axios'

const REQUEST_TIMEOUT = 30000
const TIKTOK_BASE = 'https://www.tiktok.com'
const REQUIRED_FIELDS = [
    'id',
    'uniqueId',
    'nickname',
    'avatarLarger',
    'secUid',
    'createTime',
    'followerCount',
    'followingCount',
    'heartCount',
    'videoCount',
    'friendCount'
]

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toSafe = (value, fallback = '[none]') => {
    const text = cleanText(value)
    return text || fallback
}

const toBool = (value) => (value === true ? 'yes' : 'no')

const toCompactNumber = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n)) return '0'
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const toDateFromUnix = (unixSeconds) => {
    const n = Number(unixSeconds)
    if (!Number.isFinite(n) || n <= 0) return '[none]'
    const d = new Date(n * 1000)
    if (Number.isNaN(d.getTime())) return '[none]'
    return d.toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
    })
}

const normalizeUsername = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    let candidate = raw
    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (!/(^|\.)tiktok\.com$/i.test(u.hostname)) return ''
            const first = u.pathname.split('/').filter(Boolean)[0] || ''
            candidate = first
        } catch {
            return ''
        }
    }

    candidate = candidate.replace(/^@+/, '')
    candidate = candidate.split(/[/?#]/)[0]
    candidate = cleanText(candidate).replace(/\s+/g, '')
    candidate = candidate.replace(/[^A-Za-z0-9._]/g, '')
    if (!candidate) return ''
    return candidate
}

const buildProfileUrl = (username) => `${TIKTOK_BASE}/@${encodeURIComponent(username)}`

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

const assertStrict = (meta) => {
    for (const field of REQUIRED_FIELDS) {
        const value = meta?.[field]
        const invalid =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim()) ||
            (typeof value === 'number' && !Number.isFinite(value))
        if (invalid) throw new Error(`Metadata tidak lengkap: ${field}`)
    }
}

const parseFromUniversalData = (root) => {
    const scope = root?.__DEFAULT_SCOPE__ || {}
    const detail = scope?.['webapp.user-detail'] || {}
    const userInfo = detail?.userInfo || {}
    const user = userInfo?.user || {}
    const stats = userInfo?.stats || userInfo?.statsV2 || {}

    return {
        id: cleanText(user?.id),
        uniqueId: cleanText(user?.uniqueId),
        nickname: cleanText(user?.nickname),
        avatarLarger: cleanText(user?.avatarLarger || user?.avatarMedium || user?.avatarThumb),
        avatarMedium: cleanText(user?.avatarMedium || user?.avatarThumb),
        secUid: cleanText(user?.secUid),
        createTime: Number(user?.createTime),
        verified: Boolean(user?.verified),
        privateAccount: Boolean(user?.privateAccount),
        signature: cleanText(user?.signature),
        bioLink: cleanText(user?.bioLink?.link),
        region: cleanText(user?.region || user?.language),
        commerceCategory: cleanText(user?.commerceUserInfo?.category),
        followerCount: Number(stats?.followerCount),
        followingCount: Number(stats?.followingCount),
        heartCount: Number(stats?.heartCount ?? stats?.heart),
        videoCount: Number(stats?.videoCount),
        friendCount: Number(stats?.friendCount),
        sourceShareTitle: cleanText(detail?.shareMeta?.title),
        sourceShareDesc: cleanText(detail?.shareMeta?.desc)
    }
}

const fetchTiktokProfile = async (username) => {
    const profileUrl = buildProfileUrl(username)
    const { data, status } = await axios.get(profileUrl, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.9'
        },
        validateStatus: () => true
    })

    if (status === 404) throw new Error('User TikTok tidak ditemukan')
    if (status !== 200) throw new Error(`TikTok HTTP ${status}`)

    const html = String(data || '')
    if (!html) throw new Error('Respons TikTok kosong')

    const universalData = extractJsonByScriptId(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__')
    if (!universalData) throw new Error('Gagal parse __UNIVERSAL_DATA_FOR_REHYDRATION__')

    const meta = parseFromUniversalData(universalData)
    assertStrict(meta)
    return {
        ...meta,
        source: profileUrl
    }
}

const buildCaption = (m) => (
    `\`\`\`TIKTOK STALK ${m.nickname.toUpperCase()}\n\n` +
    `× Username: @${m.uniqueId}\n` +
    `× User ID: ${m.id}\n` +
    `× Created: ${toDateFromUnix(m.createTime)}\n` +
    `× Verified: ${toBool(m.verified)}\n` +
    `× Private: ${toBool(m.privateAccount)}\n` +
    `× Followers: ${toCompactNumber(m.followerCount)}\n` +
    `× Following: ${toCompactNumber(m.followingCount)}\n` +
    `× Likes: ${toCompactNumber(m.heartCount)}\n` +
    `× Videos: ${toCompactNumber(m.videoCount)}\n` +
    `× Friends: ${toCompactNumber(m.friendCount)}\n` +
    `× Region/Language: ${toSafe(m.region)}\n` +
    `× Commerce Category: ${toSafe(m.commerceCategory)}\n` +
    `× Bio Link: ${toSafe(m.bioLink)}\n` +
    `× Bio: ${toSafe(m.signature, '[empty]')}\n` +
    `× Link: ${m.source}\`\`\``
)

export default {
    name: 'tiktokstalk',
    aliases: ['ttstalk', 'stalktiktok', 'ttprofile', 'tiktokprofile'],
    description: 'Stalk metadata lengkap akun tiktok (strict)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const username = normalizeUsername(text)

        if (!username) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} fifaworldcup`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const meta = await fetchTiktokProfile(username)
            const caption = buildCaption(meta)

            await sock.sendMessage(jid, {
                image: { url: meta.avatarLarger },
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

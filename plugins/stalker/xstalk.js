import axios from 'axios'

const REQUEST_TIMEOUT = 30000
const X_HOME_URL = 'https://x.com'
const GUEST_ACTIVATE_URL = 'https://api.x.com/1.1/guest/activate.json'
const REQUIRED_META_FIELDS = [
    'name',
    'username',
    'createdAt',
    'followers',
    'following',
    'tweets',
    'listed',
    'verified',
    'protected',
    'avatar'
]

let runtimeCache = {
    bearerToken: '',
    userByScreenNameQueryId: '',
    lastFetchAt: 0
}

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const formatNumber = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n)) return '0'
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const formatDate = (raw) => {
    const text = cleanText(raw)
    if (!text) return '-'
    const d = new Date(text)
    if (Number.isNaN(d.getTime())) return text
    return d.toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
    })
}

const extractUsername = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    let candidate = raw

    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (!/(^|\.)x\.com$/i.test(u.hostname) && !/(^|\.)twitter\.com$/i.test(u.hostname)) return ''
            candidate = u.pathname.split('/').filter(Boolean)[0] || ''
        } catch {
            return ''
        }
    }

    candidate = candidate.replace(/^@+/, '').split(/[/?#]/)[0]
    candidate = cleanText(candidate).replace(/\s+/g, '')
    if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate)) return ''
    return candidate
}

const normalizeAvatar = (url) => {
    const raw = cleanText(url)
    if (!/^https?:\/\//i.test(raw)) return null
    return raw
        .replace(/_normal\./i, '_400x400.')
        .replace(/_bigger\./i, '_400x400.')
        .replace(/_200x200\./i, '_400x400.')
}

const shouldRefreshRuntime = () => {
    const now = Date.now()
    const ageMs = now - Number(runtimeCache.lastFetchAt || 0)
    if (!runtimeCache.bearerToken || !runtimeCache.userByScreenNameQueryId) return true
    return ageMs > 10 * 60 * 1000
}

const loadRuntimeFromMainJs = async () => {
    if (!shouldRefreshRuntime()) return runtimeCache

    const { data: html, status: htmlStatus } = await axios.get(X_HOME_URL, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: 'text/html,application/xhtml+xml'
        },
        validateStatus: () => true
    })

    if (htmlStatus !== 200) throw new Error(`X home HTTP ${htmlStatus}`)

    const htmlText = String(html || '')
    const mainJsUrl = (htmlText.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[^"'\s]+\.js/) || [])[0]
    if (!mainJsUrl) throw new Error('Main JS X tidak ditemukan')

    const { data: jsBody, status: jsStatus } = await axios.get(mainJsUrl, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            accept: '*/*',
            referer: X_HOME_URL
        },
        validateStatus: () => true
    })

    if (jsStatus !== 200) throw new Error(`Main JS HTTP ${jsStatus}`)

    const jsText = String(jsBody || '')
    const queryMatch = jsText.match(/queryId:"([^"]+)",operationName:"UserByScreenName"/)
    if (!queryMatch?.[1]) throw new Error('Query ID UserByScreenName tidak ditemukan')

    const bearerRaw = (jsText.match(/AAAAAA[A-Za-z0-9%_=]+/) || [])[0] || ''
    if (!bearerRaw) throw new Error('Bearer token X tidak ditemukan')
    const bearerToken = decodeURIComponent(bearerRaw)

    runtimeCache = {
        bearerToken,
        userByScreenNameQueryId: queryMatch[1],
        lastFetchAt: Date.now()
    }
    return runtimeCache
}

const getGuestToken = async (bearerToken) => {
    const { data, status } = await axios.post(GUEST_ACTIVATE_URL, null, {
        timeout: REQUEST_TIMEOUT,
        headers: {
            authorization: `Bearer ${bearerToken}`,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            origin: X_HOME_URL,
            referer: `${X_HOME_URL}/`
        },
        validateStatus: () => true
    })

    if (status !== 200) throw new Error(`Guest activate HTTP ${status}`)
    const gt = cleanText(data?.guest_token)
    if (!gt) throw new Error('Guest token X kosong')
    return gt
}

const fetchUserByScreenName = async (username) => {
    const runtime = await loadRuntimeFromMainJs()
    const guestToken = await getGuestToken(runtime.bearerToken)

    const variables = {
        screen_name: username,
        withSafetyModeUserFields: true
    }

    const features = {
        hidden_profile_likes_enabled: true,
        hidden_profile_subscriptions_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true
    }

    const endpoint = `${X_HOME_URL}/i/api/graphql/${runtime.userByScreenNameQueryId}/UserByScreenName`
    const { data, status } = await axios.get(endpoint, {
        timeout: REQUEST_TIMEOUT,
        params: {
            variables: JSON.stringify(variables),
            features: JSON.stringify(features)
        },
        headers: {
            authorization: `Bearer ${runtime.bearerToken}`,
            'x-guest-token': guestToken,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            referer: `${X_HOME_URL}/${username}`
        },
        validateStatus: () => true
    })

    if (status !== 200) throw new Error(`UserByScreenName HTTP ${status}`)
    if (Array.isArray(data?.errors) && data.errors.length) {
        throw new Error(cleanText(data.errors[0]?.message) || 'GraphQL error')
    }

    const result = data?.data?.user?.result
    if (!result || result.__typename !== 'User') {
        throw new Error('User tidak ditemukan')
    }
    return result
}

const parseStrictMetadata = (result) => {
    const legacy = result?.legacy || {}
    const core = result?.core || {}
    const privacy = result?.privacy || {}

    const metadata = {
        id: cleanText(result?.rest_id),
        name: cleanText(core?.name),
        username: cleanText(core?.screen_name),
        createdAt: cleanText(core?.created_at),
        description: String(legacy?.description ?? ''),
        followers: Number(legacy?.followers_count),
        following: Number(legacy?.friends_count),
        tweets: Number(legacy?.statuses_count),
        listed: Number(legacy?.listed_count),
        likes: Number(legacy?.favourites_count),
        mediaCount: Number(legacy?.media_count),
        protected: typeof privacy?.protected === 'boolean' ? privacy.protected : null,
        verified: Boolean(result?.is_blue_verified || result?.verification?.verified),
        avatar: normalizeAvatar(result?.avatar?.image_url || legacy?.profile_image_url_https || ''),
        banner: cleanText(legacy?.profile_banner_url),
        pinnedTweetId: Array.isArray(legacy?.pinned_tweet_ids_str) ? cleanText(legacy.pinned_tweet_ids_str[0]) : '',
        professionalType: cleanText(result?.professional?.professional_type),
        category: Array.isArray(result?.professional?.category) && result.professional.category[0]
            ? cleanText(result.professional.category[0]?.name)
            : ''
    }

    for (const key of REQUIRED_META_FIELDS) {
        const value = metadata[key]
        const invalid =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim()) ||
            (typeof value === 'number' && !Number.isFinite(value))
        if (invalid) {
            throw new Error(`Metadata tidak lengkap: ${key}`)
        }
    }

    return metadata
}

const buildCaption = (m) => {
    const pinned = m.pinnedTweetId || '[none]'
    const prof = m.professionalType || '[none]'
    const category = m.category || '[none]'
    const banner = m.banner || '[none]'
    const bio = cleanText(m.description) || '[empty]'

    return (
        `\`\`\`X STALK ${m.name.toUpperCase()}\n\n` +
        `• Username: @${m.username}\n` +
        `• User ID: ${m.id || '-'}\n` +
        `• Created: ${formatDate(m.createdAt)}\n` +
        `• Verified: ${m.verified ? 'yes' : 'no'}\n` +
        `• Protected: ${m.protected ? 'yes' : 'no'}\n` +
        `• Followers: ${formatNumber(m.followers)}\n` +
        `• Following: ${formatNumber(m.following)}\n` +
        `• Tweets: ${formatNumber(m.tweets)}\n` +
        `• Listed: ${formatNumber(m.listed)}\n` +
        `• Likes: ${formatNumber(m.likes)}\n` +
        `• Media Count: ${formatNumber(m.mediaCount)}\n` +
        `• Professional: ${prof}\n` +
        `• Bio: ${bio}\n` +
        `• Link: https://x.com/${m.username}\`\`\``
    )
}

export default {
    name: 'xstalk',
    aliases: ['twitterstalk', 'stalkx', 'stalktwitter'],
    description: 'Stalk profil user twitter (strict metadata)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const username = extractUsername(text)

        if (!username) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} AnthropicAI`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const raw = await fetchUserByScreenName(username)
            const meta = parseStrictMetadata(raw)
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

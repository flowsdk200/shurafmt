import axios from 'axios'

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
const GRAPHQL_ENDPOINT = 'https://x.com/i/api/graphql'
const QUERY_ID = 'aFvUsJm2c-oDkJV75blV6g'
const TIMEOUT = 60000

const FEATURES = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_home_pinned_timelines_enabled: true,
    responsive_web_media_download_video_enabled: false,
    rweb_lists_timeline_redesign_enabled: true
}

let authConfig = {
    authToken: '9172e54e730e427e658f7177d345bce98a0f04f2',
    ct0: '6dd997bbdd8c9dcc8e1a59359ce5c7c9a217ae09aaf5c465f59778e622fa452aec4a4b2dab46b486b323289e837a71ea07dffdac33a079866c43d624f9333995254a49e35de0b5c0422f886a91969f70',
    twid: 'u%3D1812620233678721024',
    kdt: '8cYwn2CF170XEKSiT9s1OCpgU78QrjL3WsIY0V5j'
}

const isTwitterUrl = (url = '') => /https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i.test(String(url || ''))

const setTwitterAuth = (auth = {}) => {
    authConfig = {
        authToken: auth.authToken || authConfig.authToken,
        ct0: auth.ct0 || authConfig.ct0,
        twid: auth.twid || authConfig.twid,
        kdt: auth.kdt || authConfig.kdt
    }
}

const extractTweetId = (url) => {
    const patterns = [
        /(?:twitter|x)\.com\/\w+\/status\/(\d+)/i,
        /(?:twitter|x)\.com\/i\/web\/status\/(\d+)/i
    ]

    for (const pattern of patterns) {
        const match = String(url || '').match(pattern)
        if (match?.[1]) return match[1]
    }

    const idMatch = String(url || '').match(/(\d{15,})/)
    if (idMatch?.[1]) return idMatch[1]

    throw new Error('Link Twitter/X tidak valid')
}

const resolveShortUrl = async (url) => {
    if (!String(url || '').includes('t.co/')) return url

    const response = await axios.get(url, {
        maxRedirects: 5,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
    })

    return response.request?.res?.responseUrl || response.request?.responseURL || response.headers?.location || url
}

const fetchTweet = async (tweetId, auth) => {
    if (!auth?.authToken || !auth?.ct0) {
        throw new Error('Twitter auth belum diatur')
    }

    const variables = {
        tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false
    }

    const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(FEATURES)
    })

    const cookies = [
        `auth_token=${auth.authToken}`,
        `ct0=${auth.ct0}`,
        auth.twid ? `twid=${auth.twid}` : '',
        auth.kdt ? `kdt=${auth.kdt}` : ''
    ].filter(Boolean).join('; ')

    const response = await axios.get(`${GRAPHQL_ENDPOINT}/${QUERY_ID}/TweetResultByRestId?${params}`, {
        headers: {
            Authorization: `Bearer ${BEARER_TOKEN}`,
            Cookie: cookies,
            'X-Csrf-Token': auth.ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
            'X-Twitter-Client-Language': 'en',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            Origin: 'https://x.com',
            Referer: `https://x.com/i/status/${tweetId}`
        },
        timeout: TIMEOUT
    })

    return response.data
}

const parseMediaItem = (media = {}) => {
    const type = media.type

    if (type === 'video' || type === 'animated_gif') {
        const variants = (media.video_info?.variants || [])
            .filter((v) => v.content_type === 'video/mp4' && v.url)
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))

        const best = variants[0]
        if (!best) return null

        return {
            type: type === 'animated_gif' ? 'gif' : 'video',
            url: best.url,
            thumbnail: media.media_url_https || '',
            duration: Math.round((media.video_info?.duration_millis || 0) / 1000)
        }
    }

    if (type === 'photo') {
        let imageUrl = media.media_url_https || ''
        if (imageUrl && !imageUrl.includes('?format=')) {
            const ext = imageUrl.split('.').pop()?.split('?')[0] || 'jpg'
            imageUrl = `${imageUrl}?format=${ext}&name=large`
        }

        if (!imageUrl) return null
        return { type: 'image', url: imageUrl }
    }

    return null
}

const parseTweetResult = (data) => {
    const tweetResult = data?.data?.tweetResult?.result
    if (!tweetResult) throw new Error('Tweet tidak ditemukan')

    let tweet = tweetResult
    if (tweetResult.__typename === 'TweetWithVisibilityResults') tweet = tweetResult.tweet
    if (tweet?.__typename === 'TweetUnavailable') throw new Error('Tweet tidak tersedia')

    const legacy = tweet?.legacy
    if (!legacy) throw new Error('Gagal parse tweet')

    const userResult = tweet?.core?.user_results?.result || {}
    const userLegacy = userResult?.legacy || {}
    const userCore = userResult?.core || {}
    const userAvatar = userResult?.avatar || {}

    const author = {
        id: userResult?.rest_id || '',
        username: userCore?.screen_name || userLegacy?.screen_name || '',
        name: userCore?.name || userLegacy?.name || '',
        avatar: String(userAvatar?.image_url || userLegacy?.profile_image_url_https || '').replace('_normal', '_400x400'),
        verified: !!(userResult?.is_blue_verified || userLegacy?.verified),
        followers: userLegacy?.followers_count || 0
    }

    const media = (legacy?.extended_entities?.media || [])
        .map(parseMediaItem)
        .filter(Boolean)

    return {
        id: tweet?.rest_id || legacy?.id_str || '',
        text: legacy?.full_text || '',
        author,
        media,
        stats: {
            likes: legacy?.favorite_count || 0,
            retweets: legacy?.retweet_count || 0,
            replies: legacy?.reply_count || 0,
            views: parseInt(tweet?.views?.count || '0', 10) || 0,
            bookmarks: legacy?.bookmark_count || 0
        },
        createdAt: legacy?.created_at || '',
        isRetweet: !!legacy?.retweeted_status_result
    }
}

const twitter = async (url, options = {}) => {
    const effectiveAuth = options?.auth || authConfig
    const resolvedUrl = await resolveShortUrl(String(url || '').trim())
    const tweetId = extractTweetId(resolvedUrl)
    const rawData = await fetchTweet(tweetId, effectiveAuth)
    return parseTweetResult(rawData)
}

export {
    twitter,
    setTwitterAuth,
    isTwitterUrl
}

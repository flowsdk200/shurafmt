import axios from 'axios'

const GRAPHQL_URL = 'https://id.pinterest.com/_/graphql/'
const QUERY_HASH = '91dc7817f1acf1c2fb8d505d1c79dedebcb3baa1794065ba3602b843099f8ff7'
const DEFAULT_CSRF = 'f199c374cd68fda2595b9cc9bb9c7d5d'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const getPinterestIdFromUrl = async (pinterestUrl) => {
    const urlText = String(pinterestUrl || '').trim()
    if (!urlText) throw new Error('URL Pinterest wajib diisi.')

    let finalUrl = urlText
    if (/pin\.it/i.test(urlText)) {
        const r = await axios.get(urlText, {
            maxRedirects: 10,
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        finalUrl = String(r.request?.res?.responseUrl || urlText)
    }

    if (!/pinterest/i.test(finalUrl)) throw new Error('Hostname bukan Pinterest.')

    const u = new URL(finalUrl)
    const pinId = u.pathname.match(/\/pin\/(\d+)/)?.[1]
    if (!pinId) throw new Error('Gagal ambil pin ID dari URL.')
    return pinId
}

const serialize = (pinterestResponse) => {
    const data = pinterestResponse?.data?.v3GetPinQuery?.data
    if (!data) throw new Error('Data pin tidak ditemukan dari GraphQL.')

    const post = {
        title: String(data?.unauthOnPageTitle || '').trim() || '(no title)',
        description: String(data?.description || '').trim(),
        likesCount: Number(data?.totalReactionCount || 0),
        shareCount: Number(data?.shareCount || 0),
        commentCount: Number(data?.aggregatedPinData?.commentCount || 0),
        createdAt: String(data?.createdAt || '(unknown)')
    }

    const user = {
        fullName: String(data?.originPinner?.fullName || '(unknown)'),
        username: String(data?.originPinner?.username || '(unknown)')
    }

    const rawVideo =
        data?.storyPinData?.pages?.[0]?.blocks?.[0]?.videoDataV2?.videoList720P?.v720P ||
        data?.videos?.videoList?.v720P
    const video = typeof rawVideo === 'string' ? rawVideo : (rawVideo?.url || '')

    const images = Object.keys(data)
        .filter((k) => k.startsWith('images_'))
        .map((k) => ({ ...(data[k] || {}), name: k.replace('images_', '') }))
        .filter((x) => x && x.url)

    return {
        user,
        post,
        content: {
            images,
            videos: video ? [video] : []
        }
    }
}

const getPinterestData = async (pinterestUrl, options = {}) => {
    const pinId = await getPinterestIdFromUrl(pinterestUrl)
    const csrfToken = String(options.csrfToken || DEFAULT_CSRF).trim()
    const cookie = String(options.cookie || `csrftoken=${csrfToken};`).trim()

    const res = await axios.post(
        GRAPHQL_URL,
        {
            queryHash: QUERY_HASH,
            variables: {
                pinId,
                isAuth: false,
                isDesktop: true,
                shouldPrefetchStoryPinFragment: false,
                isUnauth: true
            }
        },
        {
            headers: {
                'accept-encoding': 'gzip, deflate, br, zstd',
                'content-type': 'application/json',
                cookie,
                'x-csrftoken': csrfToken,
                'user-agent': 'Mozilla/5.0'
            },
            timeout: 60000
        }
    )

    if (!res?.data) throw new Error('Response Pinterest kosong.')
    return serialize(res.data)
}

const pickBestImage = (images) => {
    const list = Array.isArray(images) ? images : []
    if (!list.length) return ''
    const order = ['orig', '736x', '564x', '474x', '236x', '170x', '600x315', '136x136', '60x60']
    for (const key of order) {
        const hit = list.find((x) => String(x?.name || '').toLowerCase() === key.toLowerCase() && x?.url)
        if (hit?.url) return String(hit.url)
    }
    const first = list.find((x) => x?.url)
    return first ? String(first.url) : ''
}

const parseRuntimeMeta = (html) => {
    const match = String(html || '').match(/<script id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/)
    if (!match) return { appVersion: '', handler: '' }
    try {
        const json = JSON.parse(match[1])
        return {
            appVersion: String(json?.appVersion || ''),
            handler: String(json?.initialHandlerId || '')
        }
    } catch {
        return { appVersion: '', handler: '' }
    }
}

const getCookie = (cookies, key) => {
    const raw = (cookies || []).map((x) => String(x).split(';')[0]).join('; ')
    const m = raw.match(new RegExp(`${key}=([^;]+)`))
    return {
        value: m ? String(m[1]) : '',
        header: raw
    }
}

const openSearchSession = async (query) => {
    const sourcePath = `/search/pins/?q=${encodeURIComponent(query)}`
    const sourceUrl = `https://www.pinterest.com${sourcePath}`

    const page = await axios.get(sourceUrl, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 30000
    })

    const meta = parseRuntimeMeta(page.data || '')
    const cookie = getCookie(page.headers?.['set-cookie'] || [], 'csrftoken')

    return {
        sourcePath,
        appVersion: meta.appVersion,
        handler: meta.handler,
        csrfToken: cookie.value,
        cookieHeader: cookie.header
    }
}

const searchPinterest = async (query, limit = 12) => {
    const q = String(query || '').trim()
    if (!q) throw new Error('Query Pinterest wajib diisi.')

    const target = Math.max(1, Number(limit) || 12)
    const session = await openSearchSession(q)

    const reqData = {
        options: {
            query: q,
            scope: 'pins',
            isPrefetch: false,
            no_fetch_context_on_resource: false
        },
        context: {}
    }

    const api = new URL('https://www.pinterest.com/resource/BaseSearchResource/get/')
    api.searchParams.set('source_url', session.sourcePath)
    api.searchParams.set('data', JSON.stringify(reqData))
    api.searchParams.set('_', String(Date.now()))

    const response = await axios.get(api.toString(), {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRFToken': session.csrfToken,
            'X-Pinterest-Source-Url': session.sourcePath,
            'X-Pinterest-App-Version': session.appVersion,
            'X-Pinterest-PWS-Handler': session.handler,
            'X-Pinterest-Appstate': 'active',
            Referer: 'https://www.pinterest.com',
            Cookie: session.cookieHeader
        },
        timeout: 30000
    })

    const rows = response?.data?.resource_response?.data?.results || []
    const out = []
    const seen = new Set()

    for (const pin of rows) {
        const images = pin?.images || {}
        const image = pickBestImage([
            { ...(images.orig || {}), name: 'orig' },
            { ...(images['736x'] || {}), name: '736x' },
            { ...(images['564x'] || {}), name: '564x' },
            { ...(images['474x'] || {}), name: '474x' },
            { ...(images['236x'] || {}), name: '236x' },
            { ...(images['170x'] || {}), name: '170x' }
        ])

        if (!image || seen.has(image)) continue
        seen.add(image)

        out.push({
            id: String(pin?.id || ''),
            url: pin?.id ? `https://pinterest.com/pin/${pin.id}/` : '',
            title: String(pin?.title || pin?.grid_title || pin?.description || '').trim(),
            description: String(pin?.description || '').trim(),
            image,
            author: {
                name: String(pin?.pinner?.full_name || pin?.pinner?.username || '(unknown)'),
                username: String(pin?.pinner?.username || '')
            }
        })
        if (out.length >= target) break
    }

    return out.slice(0, target)
}

export { searchPinterest, getPinterestData, serialize, getPinterestIdFromUrl }

import axios from 'axios'
import { load } from 'cheerio'
import FormData from 'form-data'
import vm from 'vm'

const decodeWrappedUrl = (value) => {
    const input = String(value || '').trim()
    if (!input) return ''

    try {
        const parsed = new URL(input)
        const encoded = parsed.searchParams.get('u')
        if (!encoded) return input
        return Buffer.from(encoded, 'base64').toString('utf8').trim() || input
    } catch {
        return input
    }
}

async function resolveTikTokUrl(url) {
    const input = String(url || '').trim()
    if (!input) throw new Error('URL TikTok kosong')

    try {
        const parsed = new URL(input)
        if (!/(^|\.)(vm|vt)\.tiktok\.com$/i.test(parsed.hostname)) {
            const cleanMatch = parsed.pathname.match(/^\/@[^/]+\/(video|photo)\/\d+/i)
            return cleanMatch?.[0] ? `${parsed.origin}${cleanMatch[0]}` : input
        }
    } catch {
        return input
    }

    const response = await axios.get(input, {
        timeout: 60000,
        maxRedirects: 10,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/'
        }
    })

    const finalUrl = String(response.request?.res?.responseUrl || response.config?.url || input).trim()
    const match = finalUrl.match(/^https?:\/\/(www\.|m\.)?tiktok\.com\/@[^/]+\/(video|photo)\/\d+/i)
    return match?.[0] || finalUrl || input
}

async function getHash(path) {
    const home = await axios.get(`https://snaptik.cx${path}`, {
        timeout: 60000,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        }
    })

    if (home.status !== 200) {
        throw new Error(`snaptik.cx HTTP ${home.status}`)
    }

    const lang = String(String(home.data || '').match(/currentLang\s*:\s*["']([^"']+)/i)?.[1] || 'en').trim() || 'en'
    const scripts = [...String(home.data || '').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    const code = scripts.find((script) => script.includes('function _0x74fb') && script.includes('eval(function'))
    if (!code) throw new Error('Hash snaptik.cx tidak ditemukan')

    const sandbox = {
        window: {},
        document: {},
        localStorage: { getItem: () => null, setItem: () => {} },
        atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
        btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
        console
    }

    vm.createContext(sandbox)
    vm.runInContext(code, sandbox, { timeout: 10000 })

    const hash = String(sandbox.window?.rB?.hash || sandbox.rB?.hash || '').trim()
    if (!hash) throw new Error('Hash snaptik.cx kosong')

    return { lang, hash }
}

async function submit(url, mode) {
    const config = {
        video: { path: '/', type: 'tiktokVideo' },
        mp3: { path: '/download-tiktok-mp3/', type: 'tiktokMp3' },
        slide: { path: '/download-tiktok-slide/', type: 'tiktokSlide' },
        story: { path: '/download-story-tiktok/', type: 'tiktokStory' }
    }[mode]

    if (!config) throw new Error(`Mode tidak didukung: ${mode}`)

    const { lang, hash } = await getHash(config.path)
    const form = new FormData()
    form.append('type', config.type)
    form.append('url', url)
    form.append('hash', hash)

    const response = await axios.post(`https://snaptik.cx/${lang}/check/`, form, {
        timeout: 60000,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Origin': 'https://snaptik.cx',
            'Referer': `https://snaptik.cx${config.path}`,
            'X-Requested-With': 'XMLHttpRequest'
        }
    })

    if (response.status !== 200) {
        const errorText = typeof response.data === 'string'
            ? response.data
            : response.data?.error || response.data?.message || ''
        throw new Error(errorText || `snaptik.cx ${mode} check HTTP ${response.status}`)
    }

    return load(String(response.data || ''))
}

async function tiktok2(url, options = {}) {
    const inputUrl = await resolveTikTokUrl(url)
    const requestedMode = String(options?.mode || '').trim().toLowerCase()
    const mode = requestedMode || (/\/photo\/\d+/i.test(inputUrl) ? 'slide' : 'video')
    const $ = await submit(inputUrl, mode)

    const author = $('.user-username').first().text().trim()
    const caption = $('.user-fullname').first().text().trim()

    if (mode === 'slide') {
        const images = $('.tt-slide > div').map((index, element) => {
            const node = $(element)
            const preview = String(node.find('img').first().attr('src') || '').trim()
            const href = String(node.find('a.btn-main[href]').first().attr('href') || '').trim()
            return {
                index: index + 1,
                url: decodeWrappedUrl(href) || preview
            }
        }).get().filter((item) => item.url)

        if (!images.length) {
            throw new Error('Foto slideshow snaptik.cx tidak ditemukan')
        }

        return {
            type: 'photo',
            url: inputUrl,
            author,
            caption,
            images,
            audioUrl: decodeWrappedUrl(String($('#render-video').attr('data-mp3') || '').trim())
        }
    }

    const downloads = $('a.btn-main[href]').map((_, element) => {
        const node = $(element)
        const text = node.text().replace(/\s+/g, ' ').trim()
        const href = String(node.attr('href') || '').trim()
        return {
            text,
            rawUrl: href,
            url: decodeWrappedUrl(href)
        }
    }).get().filter((item) => {
        if (!item.url) return false
        if (item.url === '/' || item.url === 'https://snaptik.cx' || item.url === 'https://snaptik.cx/') return false
        return /download/i.test(item.text) && !/download\s+(other|another)/i.test(item.text)
    })

    const primary = downloads[0]
    const primaryUrl = mode === 'mp3'
        ? primary?.url
        : String(primary?.rawUrl || '').trim() || primary?.url
    if (!primaryUrl) {
        throw new Error(`URL ${mode === 'mp3' ? 'audio' : 'video'} snaptik.cx tidak ditemukan`)
    }

    if (mode === 'mp3') {
        return {
            type: 'audio',
            url: inputUrl,
            author,
            caption,
            audio: primaryUrl
        }
    }

    return {
        type: 'video',
        url: inputUrl,
        author,
        caption,
        video: primaryUrl
    }
}

export { tiktok2 }

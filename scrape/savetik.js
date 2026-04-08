import { gotScraping } from 'got-scraping'
import { load } from 'cheerio'

const cleanText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getSessionCookie = async () => {
    try {
        const response = await gotScraping({
            url: 'https://savetik.co/en2',
            timeout: { request: 20000 },
            throwHttpErrors: false,
            headers: {
                'accept-language': 'en-US,en;q=0.9'
            }
        })

        return (response.headers['set-cookie'] || [])
            .map((value) => String(value || '').split(';')[0])
            .filter(Boolean)
            .join('; ')
    } catch {
        return ''
    }
}

const decodeHtml = (value = '') => String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const collectAnchors = ($) => $('a[href]').map((_, element) => ({
    text: cleanText($(element).text()),
    href: decodeHtml($(element).attr('href') || ''),
    audioUrl: decodeHtml($(element).attr('data-audioUrl') || ''),
    imageData: decodeHtml($(element).attr('data-imageData') || ''),
    onclick: String($(element).attr('onclick') || '').trim()
})).get().filter((item) => item.href)

const pickBestVideo = (anchors = []) => {
    const videos = anchors.filter((item) => /^download mp4/i.test(item.text))
    if (!videos.length) return null
    return videos.find((item) => /hd/i.test(item.text)) || videos[0]
}

const parseImages = (anchors = []) => anchors
    .filter((item) => /^download photo/i.test(item.text))
    .map((item, index) => ({
        index: index + 1,
        url: item.href
    }))

async function searchSaveTik(url) {
    const input = cleanText(url)
    if (!input) throw new Error('URL TikTok atau Douyin kosong')

    const attempts = [0, 3000, 8000, 15000]
    let lastError = null

    for (const waitMs of attempts) {
        if (waitMs) await sleep(waitMs)
        const body = new URLSearchParams({
            q: input,
            lang: 'en',
            cftoken: ''
        }).toString()

        try {
            const cookie = await getSessionCookie()
            const response = await gotScraping({
                url: 'https://savetik.co/api/ajaxSearch',
                method: 'POST',
                body,
                throwHttpErrors: false,
                timeout: { request: 20000 },
                headers: {
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    origin: 'https://savetik.co',
                    referer: 'https://savetik.co/en2',
                    'x-requested-with': 'XMLHttpRequest',
                    'accept-language': 'en-US,en;q=0.9',
                    ...(cookie ? { cookie } : {})
                }
            })

            if (Number(response.statusCode) === 429) {
                throw new Error('RATE_LIMIT')
            }

            const text = String(response.body || '').trim()
            if (!text || text.startsWith('<html') || text.startsWith('<!DOCTYPE html')) {
                throw new Error('RATE_LIMIT')
            }

            const data = JSON.parse(text)
            if (data?.status !== 'ok' || !data?.data) {
                throw new Error(data?.msg || 'Hasil SaveTik tidak ditemukan')
            }

            return String(data.data)
        } catch (error) {
            lastError = error
            const status = error?.response?.statusCode || error?.response?.status
            const message = String(error?.message || '').toLowerCase()
            const code = String(error?.code || '').toUpperCase()
            const isRateLimit = status === 429 || error?.message === 'RATE_LIMIT'
            const isTransientNetwork =
                message.includes('timeout') ||
                message.includes('timed out') ||
                ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)

            if (!isRateLimit && !isTransientNetwork) break
        }
    }

    const status = lastError?.response?.statusCode || lastError?.response?.status
    const lastMessage = String(lastError?.message || '').toLowerCase()
    if (status === 429 || lastError?.message === 'RATE_LIMIT') {
        throw new Error('SaveTik terkena rate limit, coba lagi sebentar')
    }
    if (lastMessage.includes('timeout') || lastMessage.includes('timed out')) {
        throw new Error('SaveTik timeout, coba lagi sebentar')
    }

    throw new Error(lastError?.message || 'Gagal mengambil data SaveTik')
}

async function tikdownloader(url) {
    const html = await searchSaveTik(url)
    const $ = load(html)
    const title = cleanText($('h3').first().text())
    const duration = cleanText($('.content p').first().text())
    const thumbnail = decodeHtml($('img').first().attr('src') || '')
    const anchors = collectAnchors($)
    const audio = anchors.find((item) => /^download mp3/i.test(item.text))?.href || ''
    const images = parseImages(anchors)

    if (images.length) {
        return {
            type: 'photo',
            url: cleanText(url),
            author: '',
            caption: title,
            duration,
            thumbnail,
            images,
            ...(audio ? { audio } : {})
        }
    }

    const video = pickBestVideo(anchors)
    if (!video?.href) {
        throw new Error('Video SaveTik tidak ditemukan')
    }

    return {
        type: 'video',
        url: cleanText(url),
        author: '',
        caption: title,
        duration,
        thumbnail,
        video: video.href,
        videoLabel: video.text,
        ...(audio ? { audio } : {})
    }
}

export { tikdownloader }

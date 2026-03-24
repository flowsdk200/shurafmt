import axios from 'axios'
import { CookieJar } from 'tough-cookie'
import { wrapper } from 'axios-cookiejar-support'
import { load } from 'cheerio'

const client = wrapper(axios.create({
    jar: new CookieJar(),
    timeout: 30000,
    headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'upgrade-insecure-requests': '1'
    },
    validateStatus: () => true
}))

const parseBackgroundImage = (value) => {
    const match = String(value || '').match(/url\(([^)]+)\)/i)
    return String(match?.[1] || '').trim()
}

async function getResultPage(url) {
    const input = String(url || '').trim()
    if (!input) throw new Error('URL TikTok kosong')

    const home = await client.get('https://musicaldown.com/download')
    if (home.status !== 200) {
        throw new Error(`MusicalDown HTTP ${home.status}`)
    }

    const $home = load(String(home.data || ''))
    const form = $home('#submit-form')
    if (!form.length) throw new Error('Form MusicalDown tidak ditemukan')

    const body = new URLSearchParams()

    form.find('input').each((_, element) => {
        const node = $home(element)
        const name = node.attr('name')
        const type = node.attr('type') || 'text'
        const value = node.attr('value') || ''
        if (!name) return
        body.set(name, type === 'text' ? input : value)
    })

    const result = await client.post('https://musicaldown.com/download', body.toString(), {
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'https://musicaldown.com',
            referer: 'https://musicaldown.com/download'
        }
    })

    if (result.status !== 200) {
        throw new Error(`MusicalDown download HTTP ${result.status}`)
    }

    return load(String(result.data || ''))
}

async function tikdownloader(url) {
    const $ = await getResultPage(url)

    const title = $('title').first().text().replace(/\s+/g, ' ').trim()
    const author = $('.video-author b').first().text().trim()
        || $('.video-author').first().text().trim()
        || title.replace(/\s*\|\s*Download Now!?$/i, '').trim()
    const caption = $('.video-desc').first().text().trim()
        || $('.thumbnail .content h3').first().text().replace(/\s+/g, ' ').trim()
        || ''

    if ($('#SlideButton').length || $('.card').length) {
        const images = $('.card').map((index, element) => {
            const node = $(element)
            const preview = String(node.find('.card-image img').attr('src') || '').trim()
            const downloadUrl = String(node.find('.card-action a[href]').attr('href') || '').trim()

            return {
                index: index + 1,
                url: downloadUrl || preview,
                thumbnail: preview || downloadUrl
            }
        }).get().filter((item) => item.url)

        if (!images.length) {
            throw new Error('Foto slideshow MusicalDown tidak ditemukan')
        }

        return {
            type: 'photo',
            url: String(url || '').trim(),
            author,
            caption,
            images,
            audio: String($('a.download[data-event="mp3_download_click"]').attr('href') || '').trim()
        }
    }

    const downloads = $('a.download[href], a[data-event][href]').map((_, element) => {
        const node = $(element)
        const href = String(node.attr('href') || '').trim()
        const event = String(node.attr('data-event') || '').trim().toLowerCase()
        const text = node.text().replace(/\s+/g, ' ').trim()
        return { href, event, text }
    }).get().filter((item) => item.href && /^https?:\/\//i.test(item.href))

    const video = downloads.find((item) => item.event === 'mp4_download_click')
    const videoHd = downloads.find((item) => item.event === 'hd_download_click')
    const videoWatermark = downloads.find((item) => item.event === 'watermark_download_click')
    const audio = downloads.find((item) => item.event === 'mp3_download_click')

    const primaryVideo = videoHd?.href || video?.href || videoWatermark?.href
    if (!primaryVideo) {
        throw new Error('URL video MusicalDown tidak ditemukan')
    }

    return {
        type: 'video',
        url: String(url || '').trim(),
        author,
        caption,
        thumbnail: parseBackgroundImage($('.bg-overlay').first().attr('style') || ''),
        video: primaryVideo,
        videoHd: videoHd?.href || '',
        videoWatermark: videoWatermark?.href || '',
        audio: audio?.href || ''
    }
}

export { tikdownloader }

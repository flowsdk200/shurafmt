import axios from 'axios'
import { load } from 'cheerio'

const HOME_URL = 'https://threadsmate.com/'
const ACTION_URL = 'https://threadsmate.com/action'
const PAGE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
}

const normalizeText = (value = '') => String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()

const isThreadsUrl = (url = '') => /https?:\/\/(www\.)?threads\.com\/@[^/\s]+\/post\/[A-Za-z0-9_-]+/i.test(String(url || '').trim())

async function getSession() {
    const response = await axios.get(HOME_URL, {
        timeout: 30000,
        headers: PAGE_HEADERS
    })

    const $ = load(String(response.data || ''))
    const hiddenFields = $('input[type="hidden"]').map((_, el) => ({
        name: String($(el).attr('name') || '').trim(),
        value: String($(el).attr('value') || '').trim()
    })).get().filter((item) => item.name)

    const cookie = (response.headers['set-cookie'] || [])
        .map((value) => String(value || '').split(';')[0])
        .filter(Boolean)
        .join('; ')

    if (!hiddenFields.length) {
        throw new Error('Token session ThreadsMate tidak ditemukan')
    }

    return { hiddenFields, cookie }
}

const parseMedia = (html = '') => {
    const $ = load(String(html || ''))
    const author = normalizeText($('.threadsmate-downloader-middle p span').first().text())
    const caption = normalizeText(
        $('.threadsmate-downloader-middle [title]').first().attr('title')
        || $('.threadsmate-downloader-middle [itemprop="name"]').first().text()
    )

    const media = []
    $('.download-box > li').each((index, element) => {
        const node = $(element)
        const iconClass = String(node.find('.format-icon i').attr('class') || '').trim()
        const type = iconClass.includes('icon-dlvideo') ? 'video' : iconClass.includes('icon-dlimage') ? 'image' : ''
        if (!type) return

        const optionUrls = node.find('select option').map((_, option) => String($(option).attr('value') || '').trim()).get().filter(Boolean)
        const directUrl = String(node.find('a[href]').first().attr('href') || '').trim()
        const previewUrl = String(node.find('img[data-src]').attr('data-src') || node.find('img').attr('src') || '').trim()
        const url = type === 'image'
            ? (optionUrls[0] || directUrl)
            : directUrl

        if (!url) return

        media.push({
            index: index + 1,
            type,
            url,
            previewUrl,
            resolutions: optionUrls
        })
    })

    return {
        author,
        caption,
        media
    }
}

async function threads(url) {
    const input = String(url || '').trim()
    if (!input) throw new Error('URL Threads kosong')
    if (!isThreadsUrl(input)) throw new Error('URL Threads tidak valid')

    const session = await getSession()
    const form = new URLSearchParams({ url: input })
    for (const field of session.hiddenFields) {
        form.append(field.name, field.value)
    }

    const response = await axios.post(ACTION_URL, form.toString(), {
        timeout: 30000,
        headers: {
            ...PAGE_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': 'https://threadsmate.com',
            'Referer': HOME_URL,
            'Cookie': session.cookie
        }
    })

    if (response.data?.error) {
        throw new Error(String(response.data?.message || 'ThreadsMate gagal memproses link'))
    }

    const parsed = parseMedia(response.data?.html || '')
    if (!parsed.media.length) {
        throw new Error('Media Threads tidak ditemukan')
    }

    return {
        url: input,
        author: parsed.author,
        caption: parsed.caption,
        media: parsed.media
    }
}

export { threads, isThreadsUrl }

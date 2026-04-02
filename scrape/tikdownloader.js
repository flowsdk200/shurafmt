import axios from 'axios'
import { load } from 'cheerio'

const client = axios.create({
    timeout: 60000,
    headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9'
    },
    validateStatus: () => true
})

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const pickLinkByText = ($, root, label) => {
    const match = root.find('a[href]').filter((_, element) => {
        return cleanText($(element).text()).toLowerCase() === label.toLowerCase()
    }).first()

    return String(match.attr('href') || '').trim()
}

async function tikdownloader(url) {
    const input = cleanText(url)
    if (!input) throw new Error('URL TikTok kosong')

    const body = new URLSearchParams({ url: input }).toString()
    const response = await client.post('https://snaptik.as/', body, {
        headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            origin: 'https://snaptik.as',
            referer: 'https://snaptik.as/'
        }
    })

    if (response.status !== 200) {
        throw new Error(`SnapTik HTTP ${response.status}`)
    }

    const $ = load(String(response.data || ''))
    const root = $('#main-form > div[x-data="render"]').first()
    if (!root.length) {
        throw new Error('Hasil SnapTik tidak ditemukan')
    }

    const author = cleanText(root.find('h3').first().text()) || '-'
    const rawCaption = cleanText(root.find('p.mt-2').first().text())
    const caption = /^(no description|untitled)$/i.test(rawCaption) ? '' : rawCaption
    const thumbnail = String(root.find('img').first().attr('src') || '').trim()
    const audio = pickLinkByText($, root, 'Download MP3')

    const images = root.find('.image-item').map((index, element) => {
        const card = $(element)
        const image = String(card.find('a[href]').first().attr('href') || card.find('img').first().attr('src') || '').trim()
        if (!image) return null

        return {
            index: index + 1,
            url: image
        }
    }).get().filter(Boolean)

    if (images.length) {
        return {
            type: 'photo',
            url: input,
            author,
            caption,
            thumbnail,
            images,
            ...(audio ? { audio } : {})
        }
    }

    const video = pickLinkByText($, root, 'Download Video')
    if (!video) {
        throw new Error('URL video SnapTik tidak ditemukan')
    }

    return {
        type: 'video',
        url: input,
        author,
        caption,
        thumbnail,
        video,
        ...(audio ? { audio } : {})
    }
}

export { tikdownloader }

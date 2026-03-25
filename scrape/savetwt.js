import axios from 'axios'
import { CookieJar } from 'tough-cookie'
import { wrapper } from 'axios-cookiejar-support'
import { load } from 'cheerio'

const client = wrapper(axios.create({
    jar: new CookieJar(),
    timeout: 30000,
    headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'upgrade-insecure-requests': '1'
    },
    validateStatus: () => true
}))

const isTwitterUrl = (url = '') => /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\/\d+/i.test(String(url || '').trim())

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').replace(/&quot;/g, '"').trim()

const splitAuthorCaption = (caption = '') => {
    const text = normalizeText(caption)
    const match = text.match(/^(.+?)\s+-\s+(.+)$/)
    if (!match) {
        return {
            authorName: '',
            caption: text
        }
    }

    return {
        authorName: normalizeText(match[1]),
        caption: normalizeText(match[2])
    }
}

const parseResolution = (label = '') => {
    const match = String(label || '').match(/(\d+)x(\d+)/i)
    if (!match) {
        return { width: 0, height: 0, quality: '' }
    }

    const width = Number(match[1]) || 0
    const height = Number(match[2]) || 0
    return {
        width,
        height,
        quality: `${width}x${height}`
    }
}

async function getResultPage(url) {
    const input = String(url || '').trim()
    if (!input) throw new Error('URL Twitter/X kosong')
    if (!isTwitterUrl(input)) throw new Error('Link Twitter/X tidak valid')

    const home = await client.get('https://savetwt.com/download')
    if (home.status !== 200) {
        throw new Error(`SaveTWT HTTP ${home.status}`)
    }

    const $home = load(String(home.data || ''))
    const token = String($home('meta[name="csrf-token"]').attr('content') || '').trim()
    const form = $home('form.download__form')

    if (!token) throw new Error('CSRF SaveTWT tidak ditemukan')
    if (!form.length) throw new Error('Form SaveTWT tidak ditemukan')

    const body = new URLSearchParams()

    form.find('input').each((_, element) => {
        const node = $home(element)
        const name = String(node.attr('name') || '').trim()
        if (!name) return
        body.set(name, name === 'url' ? input : String(node.attr('value') || '').trim())
    })

    if (!body.get('url')) body.set('url', input)

    const result = await client.post('https://savetwt.com/download', body.toString(), {
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'https://savetwt.com',
            referer: 'https://savetwt.com/download'
        }
    })

    if (result.status !== 200) {
        throw new Error(`SaveTWT download HTTP ${result.status}`)
    }

    const $ = load(String(result.data || ''))
    if ($('.download_item').length || $('.download__item__caption__text').length || $('a[href*="myapi.app/savetwt/proxy/"]').length) {
        return $
    }

    const errorMessage = normalizeText($('.alert.error p, .error__msg, .alert p').first().text())
    if (errorMessage) throw new Error(errorMessage)

    throw new Error('Hasil SaveTWT tidak ditemukan')
}

async function savetwt(url) {
    const input = String(url || '').trim()
    const $ = await getResultPage(input)

    const username = normalizeText($('.download__item__profile_pic span').first().text()).replace(/^Posted by\s*@/i, '').trim()
    const rawCaption = normalizeText($('.download__item__caption__text').first().text())
    const { caption } = splitAuthorCaption(rawCaption)
    const thumbnail = String($('.download__item__thumbnail img').first().attr('src') || '').trim()

    const downloads = $('tr').map((_, element) => {
        const row = $(element)
        const cells = row.find('td')
        const label = normalizeText(cells.eq(0).text())
        const href = String(cells.eq(1).find('a[href]').attr('href') || '').trim()
        if (!label || !href) return null

        const resolution = parseResolution(label)
        return {
            label,
            url: href,
            ...resolution
        }
    }).get().filter((item) => item?.url && /^https?:\/\//i.test(item.url))

    if (!downloads.length) {
        throw new Error('Link download SaveTWT tidak ditemukan')
    }

    const best = [...downloads].sort((a, b) => (b.height * b.width) - (a.height * a.width))[0]

    const selected = {
        ...best,
        label: best.quality || best.label
    }

    return {
        text: caption,
        author: username,
        media: [{
            type: 'video',
            url: selected.url,
            quality: selected.quality
        }],
    }
}

export {
    savetwt,
    isTwitterUrl
}

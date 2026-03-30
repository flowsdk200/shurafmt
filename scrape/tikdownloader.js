import axios from 'axios'
import { load } from 'cheerio'
import vm from 'node:vm'

const client = axios.create({
    timeout: 30000,
    headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9'
    },
    validateStatus: () => true
})

const decodePackedResponse = (script) => {
    const source = String(script || '').trim()
    if (!source.startsWith('var _0x') || !source.includes('eval(function')) {
        throw new Error('Respons SnapTik tidak valid')
    }

    const sandbox = {
        globalThis: {},
        window: { location: { hostname: 'snaptik.app' } },
        document: {},
        console: { log() {} },
        $: () => ({ remove() {}, style: {}, innerHTML: '' }),
        gtag() {}
    }

    vm.runInNewContext(
        source.replace('eval(function', 'globalThis.__decoded=(function'),
        sandbox,
        { timeout: 5000 }
    )

    const decoded = String(sandbox.globalThis.__decoded || '').trim()
    if (!decoded.includes('$("#download").innerHTML')) {
        throw new Error('HTML hasil SnapTik tidak ditemukan')
    }

    return decoded
}

const extractResultHtml = (decoded) => {
    const match = decoded.match(/innerHTML\s*=\s*("(?:\\.|[^"])*")/)
    if (!match?.[1]) throw new Error('Konten hasil SnapTik tidak ditemukan')
    return JSON.parse(match[1])
}

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const getFormState = async () => {
    const response = await client.get('https://snaptik.app/en2', {
        headers: {
            referer: 'https://snaptik.app/en2'
        }
    })

    if (response.status !== 200) {
        throw new Error(`SnapTik HTTP ${response.status}`)
    }

    const $ = load(String(response.data || ''))
    const token = $('input[name="token"]').attr('value')
    const lang = $('input[name="lang"]').attr('value') || 'en2'

    if (!token) throw new Error('Token SnapTik tidak ditemukan')
    return { token, lang }
}

const resolveHdUrl = async (tokenHd, backup) => {
    const fallback = String(backup || '').trim()
    const input = String(tokenHd || '').trim()
    if (!input) return fallback

    try {
        const response = await client.get(input, {
            headers: {
                accept: 'application/json,text/plain,*/*',
                referer: 'https://snaptik.app/en2',
                origin: 'https://snaptik.app'
            }
        })

        if (response.status === 200 && response.data && !response.data.error && response.data.url) {
            return String(response.data.url).trim()
        }
    } catch {}

    return fallback
}

async function tikdownloader(url) {
    const input = cleanText(url)
    if (!input) throw new Error('URL TikTok kosong')

    const { token, lang } = await getFormState()
    const body = new URLSearchParams({ url: input, lang, token }).toString()

    const response = await client.post('https://snaptik.app/abc2.php', body, {
        headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
            referer: 'https://snaptik.app/en2',
            origin: 'https://snaptik.app'
        }
    })

    if (response.status !== 200) {
        throw new Error(`SnapTik HTTP ${response.status}`)
    }

    const decoded = decodePackedResponse(String(response.data || ''))
    const html = extractResultHtml(decoded)
    const $ = load(html)

    const rawCaption = cleanText($('.video-title').first().text())
    const caption = /^(no description|untitled)$/i.test(rawCaption) ? '' : rawCaption
    const author = cleanText($('.info span').first().text()) || '-'
    const thumbnail = String($('#thumbnail').attr('src') || $('.avatar').first().attr('src') || '').trim()

    const renderButton = $('.btn-render[data-token]').first()
    if (renderButton.length) {
        const images = $('.photo a[href]').map((index, element) => ({
            index: index + 1,
            url: String($(element).attr('href') || '').trim()
        })).get().filter((item) => item.url)

        if (!images.length) {
            throw new Error('Foto slideshow SnapTik tidak ditemukan')
        }

        return {
            type: 'photo',
            url: input,
            author,
            caption,
            thumbnail,
            images
        }
    }

    const primaryVideo = String($('.download-file[href]').first().attr('href') || '').trim()
    const hdButton = $('.btn-download-hd[data-tokenhd]').first()
    const video = await resolveHdUrl(
        String(hdButton.attr('data-tokenhd') || '').trim(),
        String(hdButton.attr('data-backup') || primaryVideo).trim()
    )

    if (!video) {
        throw new Error('URL video SnapTik tidak ditemukan')
    }

    return {
        type: 'video',
        url: input,
        author,
        caption,
        thumbnail,
        video
    }
}

export { tikdownloader }

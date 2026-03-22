import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

const isGDriveUrl = (url = '') => /(?:drive\.google\.com|docs\.google\.com)/i.test(String(url))

const parseCookies = (setCookie = []) => {
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
    return arr.map((c) => String(c || '').split(';')[0]).filter(Boolean).join('; ')
}

const extractId = (url = '') => {
    const u = String(url)
    let m = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
    if (m) return m[1]
    m = u.match(/[?&]id=([a-zA-Z0-9_-]+)/)
    if (m) return m[1]
    m = u.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (m) return m[1]
    return ''
}

const findConfirmToken = (html = '') => {
    const src = String(html)
    let m = src.match(/confirm=([0-9A-Za-z_]+)&amp;id=/i)
    if (m) return m[1]
    m = src.match(/confirm=([0-9A-Za-z_]+)&id=/i)
    if (m) return m[1]
    m = src.match(/name="confirm"\s+value="([^"]+)"/i)
    if (m) return m[1]
    return ''
}

const parseDownloadForm = (html = '') => {
    const src = String(html)
    const action = src.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/i)?.[1]
        || src.match(/<form[^>]+action="([^"]+)"/i)?.[1]
        || ''

    const inputs = {}
    const re = /<input[^>]+type="hidden"[^>]*>/gi
    let m
    while ((m = re.exec(src))) {
        const tag = m[0]
        const name = tag.match(/name="([^"]+)"/i)?.[1]
        const value = tag.match(/value="([^"]*)"/i)?.[1] || ''
        if (name) inputs[name] = value
    }

    return { action, inputs }
}

async function resolveGDriveDownload(inputUrl) {
    const id = extractId(inputUrl)
    if (!id) throw new Error('ID file Google Drive tidak ditemukan')

    const base = `https://drive.google.com/uc?export=download&id=${id}`
    const first = await axios.get(base, {
        timeout: 60000,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: {
            'User-Agent': UA,
            Accept: '*/*',
            Referer: 'https://drive.google.com/'
        }
    })

    const cookies = parseCookies(first.headers['set-cookie'])
    const location = first.headers.location

    if (location) {
        const direct = location.startsWith('http') ? location : `https://drive.google.com${location}`

        /** Cek apakah URL redirect masih halaman warning HTML (butuh confirm+uuid) */
        const probe = await axios.get(direct, {
            timeout: 60000,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: {
                'User-Agent': UA,
                Accept: '*/*',
                Referer: 'https://drive.google.com/',
                ...(cookies ? { Cookie: cookies } : {})
            }
        })

        const probeType = String(probe.headers['content-type'] || '').toLowerCase()
        if (!probeType.includes('text/html')) {
            return { id, url: direct, cookies }
        }

        const { action, inputs } = parseDownloadForm(probe.data)
        const confirm = inputs.confirm || findConfirmToken(probe.data)
        if (action && confirm) {
            const u = new URL(action.startsWith('http') ? action : `https://drive.usercontent.google.com${action}`)
            Object.entries(inputs).forEach(([k, v]) => u.searchParams.set(k, v))
            if (!u.searchParams.get('id')) u.searchParams.set('id', id)
            if (!u.searchParams.get('export')) u.searchParams.set('export', 'download')
            return { id, url: u.toString(), cookies }
        }

        return { id, url: direct, cookies }
    }

    const contentType = String(first.headers['content-type'] || '').toLowerCase()
    if (!contentType.includes('text/html')) {
        return { id, url: base, cookies }
    }

    const confirm = findConfirmToken(first.data)
    if (!confirm) throw new Error('Gagal mendapatkan token konfirmasi Google Drive')

    const confirmedUrl = `https://drive.google.com/uc?export=download&confirm=${encodeURIComponent(confirm)}&id=${id}`
    return { id, url: confirmedUrl, cookies }
}

export { isGDriveUrl, resolveGDriveDownload }

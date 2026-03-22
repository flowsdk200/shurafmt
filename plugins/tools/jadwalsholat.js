import axios from 'axios'
import https from 'https'

const API_TIMINGS_BY_ADDRESS = 'https://api.aladhan.com/v1/timingsByAddress'
const API_TIMINGS_BY_CITY = 'https://api.aladhan.com/v1/timingsByCity'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

const REQUEST_TIMEOUT = 30000
const DEFAULT_METHOD = 20
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 900
const RETRYABLE_CODES = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED'])
const HTTPS_AGENT = new https.Agent({ keepAlive: true, family: 4 })

const ASEAN_COUNTRY_CODES = new Set([
    'id', // Indonesia
    'my', // Malaysia
    'sg', // Singapore
    'th', // Thailand
    'bn', // Brunei
    'vn', // Vietnam
    'ph', // Philippines
    'kh', // Cambodia
    'la', // Laos
    'mm', // Myanmar
    'tl' // Timor-Leste
])

const ASEAN_CAPITAL_BY_CODE = new Map([
    ['id', 'Jakarta'],
    ['my', 'Kuala Lumpur'],
    ['sg', 'Singapore'],
    ['th', 'Bangkok'],
    ['bn', 'Bandar Seri Begawan'],
    ['vn', 'Hanoi'],
    ['ph', 'Manila'],
    ['kh', 'Phnom Penh'],
    ['la', 'Vientiane'],
    ['mm', 'Naypyidaw'],
    ['tl', 'Dili']
])

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const cleanTime = (value) => cleanText(String(value || '').replace(/\s*\(.*?\)\s*/g, ' '))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const parseMethod = (raw) => {
    const n = Number.parseInt(cleanText(raw), 10)
    return Number.isFinite(n) ? n : DEFAULT_METHOD
}

const normalizeInput = (text) => {
    const raw = cleanText(text)
    if (!raw) return null

    if (raw.includes('|')) {
        const [cityPart, countryPart, methodPart] = raw.split('|').map((v) => cleanText(v))
        return {
            cityQuery: cityPart,
            countryQuery: countryPart,
            method: parseMethod(methodPart)
        }
    }

    if (raw.includes(',')) {
        const [cityPart, countryPart, methodPart] = raw.split(',').map((v) => cleanText(v))
        return {
            cityQuery: cityPart,
            countryQuery: countryPart,
            method: parseMethod(methodPart)
        }
    }

    return {
        cityQuery: raw,
        countryQuery: '',
        method: DEFAULT_METHOD
    }
}

const isRetryableNetworkError = (err) => {
    const code = cleanText(err?.code).toUpperCase()
    if (RETRYABLE_CODES.has(code)) return true

    const message = cleanText(err?.message).toUpperCase()
    return (
        message.includes('EAI_AGAIN') ||
        message.includes('ENOTFOUND') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('TIMEOUT')
    )
}

const fetchNominatim = async (query) => {
    const { data, status } = await axios.get(NOMINATIM_URL, {
        params: {
            q: query,
            format: 'jsonv2',
            addressdetails: 1,
            limit: 1
        },
        timeout: REQUEST_TIMEOUT,
        httpsAgent: HTTPS_AGENT,
        headers: {
            'user-agent': 'ShuraFmtBot/1.0 (jadwalsholat resolver)',
            'accept-language': 'id,en-US;q=0.9,en;q=0.8',
            Accept: 'application/json,text/plain,*/*'
        },
        validateStatus: () => true
    })

    if (status !== 200 || !Array.isArray(data) || !data.length) {
        throw new Error('lokasi tidak ditemukan')
    }

    return data[0]
}

const pickCityFromAddress = (addr = {}) => cleanText(
    addr.city ||
    addr.town ||
    addr.municipality ||
    addr.county ||
    addr.state_district ||
    addr.village ||
    addr.hamlet ||
    addr.suburb ||
    ''
)

const resolveAseanLocation = async ({ cityQuery, countryQuery }) => {
    const q1 = countryQuery
        ? `${cityQuery}, ${countryQuery}`
        : cityQuery

    let geo = null
    try {
        geo = await fetchNominatim(q1)
    } catch {
        if (!countryQuery) throw new Error('lokasi tidak ditemukan')
        geo = await fetchNominatim(cityQuery)
    }

    const addr = geo?.address || {}
    const countryCode = cleanText(addr.country_code).toLowerCase()
    const country = cleanText(addr.country)

    if (!countryCode || !country) {
        throw new Error('lokasi tidak valid')
    }

    if (!ASEAN_COUNTRY_CODES.has(countryCode)) {
        throw new Error('hanya mendukung wilayah asia tenggara.')
    }

    let city = pickCityFromAddress(addr)
    if (!city) {
        city = ASEAN_CAPITAL_BY_CODE.get(countryCode) || ''
    }

    if (!city) {
        throw new Error('kota tidak bisa di resolve. gunakan format: kota|negara')
    }

    return {
        city,
        country,
        countryCode,
        address: cleanText(geo?.display_name || `${city}, ${country}`)
    }
}

const requestTiming = async (url, params) => {
    const { data, status } = await axios.get(url, {
        params,
        timeout: REQUEST_TIMEOUT,
        httpsAgent: HTTPS_AGENT,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json,text/plain,*/*'
        },
        validateStatus: () => true
    })

    if (status !== 200) {
        throw new Error(`HTTP ${status}`)
    }
    if (!data || Number(data.code) !== 200 || !data.data?.timings) {
        throw new Error(cleanText(data?.status) || 'Data jadwal tidak tersedia')
    }
    return data.data
}

const fetchJadwalSholat = async ({ city, country, address, method }) => {
    let lastError = null

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            try {
                return await requestTiming(API_TIMINGS_BY_ADDRESS, { address, method })
            } catch {
                return await requestTiming(API_TIMINGS_BY_CITY, { city, country, method })
            }
        } catch (err) {
            lastError = err
            if (attempt < MAX_RETRIES && isRetryableNetworkError(err)) {
                await delay(RETRY_DELAY_MS * attempt)
                continue
            }
            break
        }
    }

    throw lastError || new Error('Gagal ambil data jadwal')
}

const formatResult = (payload, resolved) => {
    const timings = payload.timings || {}
    const meta = payload.meta || {}
    const methodName = cleanText(meta?.method?.name) || '-'

    return (
        `\`\`\`JADWAL SHOLAT ${resolved.city.toUpperCase()}, ${resolved.country.toUpperCase()}\n\n` +
        `• Lokasi   : ${resolved.address}\n` +
        `• Timezone : ${cleanText(meta.timezone) || '-'}\n` +
        `• Metode   : ${methodName}\n\n` +
        `• Imsak    : ${cleanTime(timings.Imsak) || '-'}\n` +
        `• Subuh    : ${cleanTime(timings.Fajr) || '-'}\n` +
        `• Terbit   : ${cleanTime(timings.Sunrise) || '-'}\n` +
        `• Dzuhur   : ${cleanTime(timings.Dhuhr) || '-'}\n` +
        `• Ashar    : ${cleanTime(timings.Asr) || '-'}\n` +
        `• Maghrib  : ${cleanTime(timings.Maghrib) || '-'}\n` +
        `• Isya     : ${cleanTime(timings.Isha) || '-'}\`\`\``
    )
}

export default {
    name: 'jadwalsholat',
    aliases: ['jadwalshalat', 'sholat', 'shalat', 'kadwalsholat', 'jws'],
    description: 'Cek jadwal sholat kota Asia Tenggara',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const params = normalizeInput(text)

        if (!params?.cityQuery || cleanText(text) === '?' || cleanText(text).toLowerCase() === 'help') {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} jakarta\n` +
                    `- ${prefix + command} johor\n` +
                    `- ${prefix + command} manila`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const resolved = await resolveAseanLocation(params)
            const payload = await fetchJadwalSholat({
                city: resolved.city,
                country: resolved.country,
                address: resolved.address,
                method: params.method
            })

            const caption = formatResult(payload, resolved)
            await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const message = cleanText(err?.message)
            const isDnsIssue = /EAI_AGAIN|ENOTFOUND/i.test(message)
            const errMsg = isDnsIssue
                ? 'DNS ke layanan jadwal sedang bermasalah, coba ulang beberapa detik lagi.'
                : (message || 'coba lagi nanti.')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${errMsg}`
            }, { quoted: msg })
        }
    }
}

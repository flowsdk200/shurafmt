import axios from 'axios'

const WISE_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
}

const USD_TO_IDR_URL = 'https://wise.com/us/currency-converter/usd-to-idr-rate/history'
const IDR_TO_USD_URL = 'https://wise.com/us/currency-converter/idr-to-usd-rate'

const extractRate = (html, regex) => {
    const match = String(html || '').match(regex)
    if (!match?.[1]) return null
    return match[1]
}

const parseLocalizedNumber = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return NaN

    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) {
        return Number.parseFloat(raw.replace(/,/g, ''))
    }

    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) {
        return Number.parseFloat(raw.replace(/\./g, '').replace(',', '.'))
    }

    if (/^\d+,\d+$/.test(raw)) {
        return Number.parseFloat(raw.replace(',', '.'))
    }

    return Number.parseFloat(raw)
}

const parseInputAmount = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return NaN

    const cleaned = raw.replace(/[$Rp\s]/gi, '')
    if (!cleaned) return NaN

    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
        return Number.parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
    }

    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
        return Number.parseFloat(cleaned.replace(/,/g, ''))
    }

    if (/^\d+,\d+$/.test(cleaned)) {
        return Number.parseFloat(cleaned.replace(',', '.'))
    }

    return Number.parseFloat(cleaned)
}

const formatUsd = (value) => `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
}).format(Number(value) || 0)}`

const formatIdr = (value) => `Rp${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
}).format(Number(value) || 0)}`

const row = (label, value) => ` • ${label.padEnd(6, ' ')} : ${value}`

const getWisePage = async (url) => {
    const { data } = await axios.get(url, {
        headers: WISE_HEADERS,
        timeout: 30000
    })
    return String(data || '')
}

const getUsdToIdrRate = async () => {
    const html = await getWisePage(USD_TO_IDR_URL)
    const rawRate = extractRate(html, /\$1 USD = ([0-9,]+(?:\.\d+)?) IDR/i)
    const rate = parseLocalizedNumber(rawRate)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Rate USD ke IDR tidak ditemukan')
    return rate
}

const getIdrToUsdRate = async () => {
    const html = await getWisePage(IDR_TO_USD_URL)
    const rawRate = extractRate(html, /Rp1 IDR = ([0-9.]+(?:,\d+)?) USD/i)
    const rate = parseLocalizedNumber(rawRate)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Rate IDR ke USD tidak ditemukan')
    return rate
}

export {
    formatIdr,
    formatUsd,
    getIdrToUsdRate,
    getUsdToIdrRate,
    parseInputAmount,
    row
}

import axios from 'axios'
import * as cheerio from 'cheerio'

const REQUEST_TIMEOUT = 20000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map()

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const decodeHtmlText = (value) => {
    const raw = String(value || '')
    if (!raw) return ''
    const $ = cheerio.load(`<div>${raw}</div>`)
    return cleanText($('div').text())
}

const normalizeWord = (value) => cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z]/g, '')

const htmlToText = (html) => {
    const $ = cheerio.load(`<div>${String(html || '')}</div>`)
    return cleanText($('div').text())
}

const makeFail = (word, reason = 'Kata tidak valid di KBBI') => ({
    ok: false,
    word,
    lemma: '',
    definition: '',
    reason
})

const makeSuccess = (word, lemma, definition) => ({
    ok: true,
    word,
    lemma,
    definition
})

const setCache = (key, value) => {
    cache.set(key, {
        ...value,
        ts: Date.now()
    })
}

const getCache = (key) => {
    const row = cache.get(key)
    if (!row) return null
    if ((Date.now() - row.ts) > CACHE_TTL_MS) {
        cache.delete(key)
        return null
    }
    return row
}

const pickValidEntry = (entries, normalized) => {
    for (const item of entries) {
        if (!item || typeof item !== 'object') continue
        const rawWord = decodeHtmlText(item.w)
        const lemma = normalizeWord(rawWord)
        if (!lemma || lemma !== normalized) continue
        const definition = htmlToText(item.d || '')
        if (!definition) continue
        return {
            lemma: rawWord || normalized,
            definition
        }
    }
    return null
}

export const normalizeKbbiWord = (value) => normalizeWord(value)

export const validateKbbiWord = async (input, { forceRefresh = false } = {}) => {
    const normalized = normalizeWord(input)
    if (!normalized) return makeFail(normalized, 'Kata kosong')
    if (normalized.length < 2) return makeFail(normalized, 'Kata terlalu pendek')

    if (!forceRefresh) {
        const cached = getCache(normalized)
        if (cached) return cached
    }

    try {
        const target = `https://kbbi.web.id/${encodeURIComponent(normalized)}`
        const response = await axios.get(target, {
            timeout: REQUEST_TIMEOUT,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8'
            }
        })

        if (response.status !== 200) {
            const fail = makeFail(normalized, `HTTP ${response.status}`)
            setCache(normalized, fail)
            return fail
        }

        const html = String(response.data || '')
        const $ = cheerio.load(html)
        const jsonText = $('#jsdata').text()

        let parsed = []
        try {
            parsed = JSON.parse(jsonText || '[]')
        } catch {
            parsed = []
        }

        const picked = pickValidEntry(parsed, normalized)
        if (!picked) {
            const fail = makeFail(normalized, 'Kata tidak ditemukan di KBBI')
            setCache(normalized, fail)
            return fail
        }

        const ok = makeSuccess(normalized, picked.lemma, picked.definition)
        setCache(normalized, ok)
        return ok
    } catch (err) {
        const fail = makeFail(normalized, `Gagal akses KBBI: ${err?.message || 'Unknown error'}`)
        return fail
    }
}

export default {
    normalizeKbbiWord,
    validateKbbiWord
}

import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://cookpad.com'
const REQUEST_TIMEOUT = 30000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const MAX_TEXT_LENGTH = 3500

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const decodeHtmlEntities = (value) => String(value || '')
    .replace(/&#(x[a-fA-F0-9]+|\d+);/g, (_, code) => {
        const point = code.startsWith('x')
            ? Number.parseInt(code.slice(1), 16)
            : Number.parseInt(code, 10)
        return Number.isFinite(point) ? String.fromCodePoint(point) : ''
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const toAbsoluteUrl = (url) => {
    const raw = cleanText(url)
    if (!raw) return null

    try {
        return new URL(raw, BASE_URL).href
    } catch {
        return null
    }
}

const splitToChunks = (text, maxLength = MAX_TEXT_LENGTH) => {
    const value = String(text || '').trim()
    if (!value) return ['']

    const chunks = []
    let remaining = value

    while (remaining.length > maxLength) {
        let cutPoint = remaining.lastIndexOf('\n', maxLength)
        if (cutPoint <= 0) cutPoint = remaining.lastIndexOf(' ', maxLength)
        if (cutPoint <= 0) cutPoint = maxLength

        chunks.push(remaining.slice(0, cutPoint).trimEnd())
        remaining = remaining.slice(cutPoint).trimStart()
    }

    if (remaining) chunks.push(remaining)
    return chunks
}

const normalizeRecipeInput = (raw) => cleanText(raw)

const extractRecipeId = (input) => {
    const raw = normalizeRecipeInput(input)
    if (!raw) return null

    if (/^\d{5,}$/.test(raw)) return raw

    const pathMatch = raw.match(/\/(?:id\/)?resep\/(\d+)/i)
    if (pathMatch?.[1]) return pathMatch[1]

    try {
        const url = new URL(raw, BASE_URL)
        const match = url.pathname.match(/\/(?:id\/)?resep\/(\d+)/i)
        if (match?.[1]) return match[1]
    } catch {}

    return null
}

const buildRecipeUrl = (input, recipeId) => {
    const raw = normalizeRecipeInput(input)
    if (raw) {
        const absolute = toAbsoluteUrl(raw)
        if (absolute && /cookpad\.com$/i.test(new URL(absolute).hostname) && /\/(?:id\/)?resep\/\d+/i.test(new URL(absolute).pathname)) {
            return absolute
        }
    }

    return `${BASE_URL}/id/resep/${recipeId}`
}

const fetchRecipeHtml = async (url) => {
    const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 8,
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache'
        }
    })

    const html = typeof response.data === 'string' ? response.data : String(response.data || '')
    if (response.status >= 400) throw new Error(`HTTP ${response.status}`)
    if (!html || html.length < 500) throw new Error('Respons halaman Cookpad tidak valid.')
    if (/just a moment|enable javascript and cookies|cloudflare/i.test(html)) {
        throw new Error('security challenge')
    }

    return html
}

const fetchImageBuffer = async (url) => {
    const target = toAbsoluteUrl(url)
    if (!target) return null

    const response = await axios.get(target, {
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 8,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            Referer: BASE_URL
        }
    })

    if (response.status >= 400) return null

    const contentType = String(response.headers?.['content-type'] || '').toLowerCase()
    if (contentType && !contentType.startsWith('image/')) return null

    const buffer = Buffer.from(response.data || [])
    return buffer.length ? buffer : null
}

const normalizeJsonPayload = (payload) => {
    if (!payload) return []
    if (Array.isArray(payload)) return payload
    if (Array.isArray(payload['@graph'])) return payload['@graph']
    return [payload]
}

const findRecipeJsonLd = ($) => {
    const scripts = $('script[type="application/ld+json"]').map((_, el) => $(el).text()).get()

    for (const rawScript of scripts) {
        const raw = String(rawScript || '').trim()
        if (!raw) continue

        try {
            const parsed = JSON.parse(raw)
            const entries = normalizeJsonPayload(parsed)
            const recipe = entries.find((entry) => {
                const typeValue = entry?.['@type']
                if (Array.isArray(typeValue)) {
                    return typeValue.some((type) => String(type).toLowerCase() === 'recipe')
                }
                return String(typeValue || '').toLowerCase() === 'recipe'
            })

            if (recipe) return recipe
        } catch {
            // ignore malformed ld+json
        }
    }

    return null
}

const normalizeInstructions = (value) => {
    if (!value) return []

    if (typeof value === 'string') {
        const text = cleanText(decodeHtmlEntities(value))
        return text ? [text] : []
    }

    if (Array.isArray(value)) {
        return value.flatMap((item) => normalizeInstructions(item))
    }

    if (typeof value === 'object') {
        if (value.text) {
            const text = cleanText(decodeHtmlEntities(value.text))
            return text ? [text] : []
        }

        if (value.itemListElement) {
            return normalizeInstructions(value.itemListElement)
        }
    }

    return []
}

const parseDomIngredients = ($) => $('li[id^="ingredient_"]').map((_, el) => {
    const amount = cleanText($(el).find('bdi').first().text())
    const name = cleanText($(el).find('span').last().text())
    return cleanText([amount, name].filter(Boolean).join(' '))
}).get().filter(Boolean)

const parseDomSteps = ($) => $('li.step').map((_, el) => {
    const text = cleanText($(el).find('p').map((__, p) => $(p).text()).get().join(' '))
    return text
}).get().filter(Boolean)

const parseDomTips = ($) => {
    const heading = $('h2,h3').filter((_, el) => /tips/i.test(cleanText($(el).text()))).first()
    if (!heading.length) return ''

    const sectionText = cleanText(heading.parent().parent().text())
        .replace(/^tips\s*/i, '')
        .trim()

    return sectionText || ''
}

const parseRecipePage = (html, fallbackUrl) => {
    const $ = cheerio.load(html)
    const recipeJson = findRecipeJsonLd($)

    const title = cleanText(
        recipeJson?.name ||
        $('h1').first().text() ||
        $('meta[property="og:title"]').attr('content')
    )
    const author = cleanText(
        recipeJson?.author?.name ||
        recipeJson?.author ||
        $('a[href*="/pengguna/"]').first().text()
    ) || '-'
    const description = cleanText(
        recipeJson?.description ||
        $('meta[property="og:description"]').attr('content')
    ) || '-'
    const image = toAbsoluteUrl(
        recipeJson?.image?.[0] ||
        recipeJson?.image ||
        $('meta[property="og:image"]').attr('content')
    )
    const url = toAbsoluteUrl(
        recipeJson?.url ||
        $('link[rel="canonical"]').attr('href') ||
        fallbackUrl
    ) || fallbackUrl
    const yieldText = cleanText(recipeJson?.recipeYield || $('#serving_recipe, [id^="serving_recipe_"]').first().text()) || '-'
    const ingredients = (Array.isArray(recipeJson?.recipeIngredient) ? recipeJson.recipeIngredient : [])
        .map((item) => cleanText(decodeHtmlEntities(item)))
        .filter(Boolean)
    const steps = normalizeInstructions(recipeJson?.recipeInstructions)
    const tips = cleanText(decodeHtmlEntities(recipeJson?.howToTip || '')) || parseDomTips($) || '-'
    const publishedAt = cleanText(recipeJson?.datePublished || '')
    const keywords = Array.isArray(recipeJson?.keywords)
        ? recipeJson.keywords.map((item) => cleanText(item)).filter(Boolean)
        : cleanText(recipeJson?.keywords).split(',').map((item) => cleanText(item)).filter(Boolean)

    const finalIngredients = ingredients.length ? ingredients : parseDomIngredients($)
    const finalSteps = steps.length ? steps : parseDomSteps($)

    if (!title || (!finalIngredients.length && !finalSteps.length)) {
        throw new Error('Struktur resep Cookpad tidak dikenali.')
    }

    return {
        title,
        author,
        description,
        image,
        url,
        yieldText,
        tips,
        ingredients: finalIngredients,
        steps: finalSteps,
        keywords,
        publishedAt
    }
}

const buildHeader = (recipe) => {
    const parts = [
        `Title: ${recipe.title}`,
        `Author: ${recipe.author}`,
        `Porsi: ${recipe.yieldText}`
    ]

    if (recipe.publishedAt) parts.push(`Publish: ${recipe.publishedAt}`)
    parts.push(`Link: ${recipe.url}`)

    return `\`\`\`${parts.join('\n')}\`\`\``
}

const buildBody = (recipe) => {
    const descriptionBlock = recipe.description && recipe.description !== '-'
        ? `Deskripsi:\n${recipe.description}\n\n`
        : ''
    const keywordsBlock = recipe.keywords.length
        ? `Keyword: ${recipe.keywords.slice(0, 8).join(', ')}\n\n`
        : ''
    const ingredientsBlock = recipe.ingredients.length
        ? recipe.ingredients.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
        : '-'
    const stepsBlock = recipe.steps.length
        ? recipe.steps.map((item, idx) => `${idx + 1}. ${item}`).join('\n\n')
        : '-'
    const tipsBlock = recipe.tips && recipe.tips !== '-'
        ? `\n\nTips:\n${recipe.tips}`
        : ''

    return (
        `${descriptionBlock}${keywordsBlock}` +
        `Bahan:\n${ingredientsBlock}\n\n` +
        `Cara Membuat:\n${stepsBlock}${tipsBlock}`
    ).trim()
}

export default {
    name: 'cookpadread',
    aliases: ['cpread'],
    description: 'Baca detail resep Cookpad dari 1 halaman resep',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const recipeInput = normalizeRecipeInput(text)

        if (!recipeInput) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://cookpad.com/id/resep/25461403\n- ${prefix + command} 25461403`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const recipeId = extractRecipeId(recipeInput)
            if (!recipeId) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Format tidak valid. Gunakan link atau ID resep Cookpad.\n\nContoh:\n- ${prefix + command} https://cookpad.com/id/resep/25461403`
                }, { quoted: msg })
            }

            const recipeUrl = buildRecipeUrl(recipeInput, recipeId)
            const html = await fetchRecipeHtml(recipeUrl)
            const recipe = parseRecipePage(html, recipeUrl)
            const header = buildHeader(recipe)
            const bodyChunks = splitToChunks(buildBody(recipe))
            const imageBuffer = recipe.image ? await fetchImageBuffer(recipe.image).catch(() => null) : null

            if (imageBuffer) {
                await sock.sendMessage(jid, {
                    image: imageBuffer,
                    caption: header
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, { text: header }, { quoted: msg })
            }

            for (const chunk of bodyChunks) {
                await sock.sendMessage(jid, { text: chunk }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const lowerMessage = String(err?.message || '').toLowerCase()
            if (lowerMessage.includes('security challenge')) {
                return sock.sendMessage(jid, {
                    text: '❌ Gagal mengakses halaman resep Cookpad (security challenge)'
                }, { quoted: msg })
            }

            const msgErr = err?.response?.status
                ? `❌ Gagal baca resep Cookpad: HTTP ${err.response.status}`
                : `❌ Gagal baca resep Cookpad: ${err.message}`

            await sock.sendMessage(jid, {
                text: msgErr
            }, { quoted: msg })
        }
    }
}

import axios from 'axios'
import * as cheerio from 'cheerio'

const MOBILE_BASE = 'https://m.gsmarena.com/'
const SEARCH_ENDPOINT = `${MOBILE_BASE}results.php3`
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    try {
        return new URL(raw, MOBILE_BASE).toString()
    } catch {
        return ''
    }
}

const toSearchKey = (value) => cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const decodeSlug = (slug) => cleanText(String(slug || '')
    .replace(/-\d+$/i, '')
    .replace(/[_-]+/g, ' '))

const resolveInput = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return { query: '', detailUrl: '' }

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (!/(^|\.)gsmarena\.com$/i.test(url.hostname)) {
                return { query: text, detailUrl: '' }
            }

            const detailMatch = url.pathname.match(/\/([^/]+-\d+)\.php$/i)
            if (detailMatch?.[1]) {
                return {
                    query: decodeSlug(detailMatch[1]),
                    detailUrl: url.toString()
                }
            }

            const sName = cleanText(url.searchParams.get('sName') || url.searchParams.get('sSearch'))
            if (sName) return { query: sName, detailUrl: '' }
        } catch {
            return { query: text, detailUrl: '' }
        }
    }

    return { query: text, detailUrl: '' }
}

const fetchHtml = async (url, params = undefined) => {
    const response = await axios.get(url, {
        params,
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    })

    if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
    }

    const html = String(response.data || '')
    if (!html.trim()) throw new Error('Respons kosong')
    return html
}

const parseSearchRows = (html) => {
    const $ = cheerio.load(html)
    const rows = []
    const seen = new Set()

    $('div.general-menu li').each((_, el) => {
        const a = $(el).find('a[href$=".php"]').first()
        if (!a.length) return

        const link = normalizeUrl(a.attr('href'))
        if (!link) return

        const img = normalizeUrl(a.find('img').attr('src'))
        const imgTitle = cleanText(a.find('img').attr('title'))
        const name = cleanText(a.find('strong').text())
        const title = imgTitle || name
        if (!title) return

        const key = link.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)

        rows.push({
            name: name || title,
            title,
            link,
            image: img,
            source: 'GSMArena'
        })
    })

    return rows
}

const scoreRow = (row, query) => {
    const q = toSearchKey(query)
    const name = toSearchKey(row?.name)
    const title = toSearchKey(row?.title)
    if (!q) return 0

    let score = 0
    if (name === q) score += 1000
    if (title === q) score += 950
    if (name.startsWith(q)) score += 700
    if (title.startsWith(q)) score += 650
    if (name.includes(q)) score += 450
    if (title.includes(q)) score += 400

    const parts = q.split(' ').filter(Boolean)
    if (parts.length) {
        const text = `${name} ${title}`
        const hit = parts.filter((p) => text.includes(p)).length
        score += hit * 70
        if (hit === parts.length) score += 200
    }

    const lenDiff = Math.abs((name || title).length - q.length)
    score -= Math.min(lenDiff, 120)
    return score
}

const pickBestRow = (rows, query) => {
    if (!Array.isArray(rows) || !rows.length) return null
    return rows
        .map((row) => ({ row, score: scoreRow(row, query) }))
        .sort((a, b) => b.score - a.score)[0]?.row || rows[0]
}

const getSpecByKey = ($, key) => cleanText($(`[data-spec="${key}"]`).first().text())

const getSpecByLabel = ($, label) => {
    const target = toSearchKey(label)
    let val = ''
    $('td.ttl').each((_, el) => {
        if (val) return
        const current = toSearchKey($(el).text())
        if (current !== target) return
        val = cleanText($(el).next('td.nfo').text())
    })
    return val
}

const parseDetail = (html, fallbackUrl) => {
    const $ = cheerio.load(html)
    const canonical = normalizeUrl($('link[rel="canonical"]').attr('href')) || normalizeUrl(fallbackUrl)
    const name = cleanText($('h1.section.nobor').first().text()) || cleanText($('title').first().text().replace(/- Full phone specifications/i, ''))
    const image = normalizeUrl($('.specs-cp-pic-rating img').first().attr('src'))
    const metaDesc = cleanText($('meta[name="Description"]').attr('content'))

    const specs = {
        announced: getSpecByKey($, 'year'),
        status: getSpecByKey($, 'status'),
        dimensions: getSpecByKey($, 'dimensions'),
        weight: getSpecByKey($, 'weight'),
        build: getSpecByKey($, 'build'),
        sim: getSpecByKey($, 'sim'),
        display: getSpecByKey($, 'displaytype'),
        size: getSpecByKey($, 'displaysize'),
        resolution: getSpecByKey($, 'displayresolution'),
        protection: getSpecByKey($, 'displayprotection'),
        os: getSpecByKey($, 'os'),
        chipset: getSpecByKey($, 'chipset'),
        cpu: getSpecByKey($, 'cpu'),
        gpu: getSpecByKey($, 'gpu'),
        cardSlot: getSpecByKey($, 'memoryslot'),
        storage: getSpecByKey($, 'internalmemory'),
        mainCamera: getSpecByKey($, 'cam1modules'),
        mainVideo: getSpecByKey($, 'cam1video'),
        selfieCamera: getSpecByKey($, 'cam2modules'),
        selfieVideo: getSpecByKey($, 'cam2video'),
        wlan: getSpecByKey($, 'wlan'),
        bluetooth: getSpecByKey($, 'bluetooth'),
        gps: getSpecByKey($, 'gps'),
        nfc: getSpecByKey($, 'nfc'),
        usb: getSpecByKey($, 'usb'),
        sensors: getSpecByKey($, 'sensors'),
        battery: getSpecByKey($, 'batdescription1'),
        colors: getSpecByKey($, 'colors'),
        models: getSpecByKey($, 'models'),
        price: getSpecByKey($, 'price'),
        charging: getSpecByLabel($, 'Charging'),
        loudspeaker: getSpecByLabel($, 'Loudspeaker'),
        jack: getSpecByLabel($, '3.5mm jack')
    }

    return {
        name: name || '-',
        image,
        link: canonical || '-',
        desc: metaDesc || '-',
        specs
    }
}

const rowLine = (label, value) => `× ${label}: ${cleanText(value) || '-'}`

const buildCaption = (detail) => {
    const s = detail.specs || {}
    return (
        `GSMARENA: ${cleanText(detail.name).toUpperCase()}\n\n` +
        rowLine('Desc', detail.desc) + '\n\n' +
        rowLine('Announced', s.announced) + '\n' +
        rowLine('Status', s.status) + '\n' +
        rowLine('Dimensions', s.dimensions) + '\n' +
        rowLine('Weight', s.weight) + '\n' +
        rowLine('Build', s.build) + '\n' +
        rowLine('SIM', s.sim) + '\n\n' +
        rowLine('Display', s.display) + '\n' +
        rowLine('Size', s.size) + '\n' +
        rowLine('Resolution', s.resolution) + '\n' +
        rowLine('Protection', s.protection) + '\n\n' +
        rowLine('OS', s.os) + '\n' +
        rowLine('Chipset', s.chipset) + '\n' +
        rowLine('CPU', s.cpu) + '\n' +
        rowLine('GPU', s.gpu) + '\n\n' +
        rowLine('Card Slot', s.cardSlot) + '\n' +
        rowLine('Storage', s.storage) + '\n\n' +
        rowLine('Main Camera', s.mainCamera) + '\n' +
        rowLine('Main Video', s.mainVideo) + '\n' +
        rowLine('Selfie Camera', s.selfieCamera) + '\n' +
        rowLine('Selfie Video', s.selfieVideo) + '\n\n' +
        rowLine('Loudspeaker', s.loudspeaker) + '\n' +
        rowLine('3.5mm Jack', s.jack) + '\n' +
        rowLine('WLAN', s.wlan) + '\n' +
        rowLine('Bluetooth', s.bluetooth) + '\n' +
        rowLine('GPS', s.gps) + '\n' +
        rowLine('NFC', s.nfc) + '\n' +
        rowLine('USB', s.usb) + '\n' +
        rowLine('Sensors', s.sensors) + '\n\n' +
        rowLine('Battery', s.battery) + '\n' +
        rowLine('Charging', s.charging) + '\n' +
        rowLine('Colors', s.colors) + '\n' +
        rowLine('Models', s.models) + '\n' +
        rowLine('Price', s.price) + '\n\n' +
        rowLine('Link', detail.link)
    )
}

export default {
    name: 'gsmarena',
    aliases: ['gsm', 'gsmsearch'],
    description: 'Cari info spek HP dari GSMArena',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const input = resolveInput(text)

        if (!input.query && !input.detailUrl) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} xiaomi 17 ultra`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            let detailUrl = input.detailUrl

            if (!detailUrl) {
                const searchHtml = await fetchHtml(SEARCH_ENDPOINT, {
                    sQuickSearch: 'yes',
                    sName: input.query
                })
                const rows = parseSearchRows(searchHtml)
                if (!rows.length) throw new Error('Tidak ada hasil GSMArena')
                const best = pickBestRow(rows, input.query)
                detailUrl = best?.link || ''
            }

            if (!detailUrl) throw new Error('Link detail tidak ditemukan')

            const detailHtml = await fetchHtml(detailUrl)
            const detail = parseDetail(detailHtml, detailUrl)
            const caption = buildCaption(detail)

            if (detail.image) {
                await sock.sendMessage(jid, {
                    image: { url: detail.image },
                    caption: `\`\`\`${caption}\`\`\``
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: `\`\`\`${caption}\`\`\``
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}

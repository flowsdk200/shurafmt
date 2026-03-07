import axios from 'axios'
import * as cheerio from 'cheerio'

const SEARCH_URL = 'https://search.brave.com/search'
const BASE_URL = 'https://search.brave.com'
const MAX_RESULTS = 10
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return null
    if (raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return null

    try {
        const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, BASE_URL)
        url.hash = ''
        return url.toString()
    } catch {
        return null
    }
}

const extractSource = ($snippet) => {
    const directSource = cleanText($snippet.find('.site-name-content .desktop-small-semibold').first().text())
    if (directSource) return directSource

    const cite = cleanText($snippet.find('cite.snippet-url').first().text())
    if (!cite) return '-'
    return cleanText(cite.split('›')[0]) || '-'
}

const parseSnippet = ($, snippetEl) => {
    const $snippet = $(snippetEl)
    if ($snippet.attr('data-type') !== 'web') return null

    const title = cleanText($snippet.find('.search-snippet-title').first().text())
    const link = normalizeUrl($snippet.find('a[href]').first().attr('href'))
    if (!title || !link) return null

    const desc = cleanText(
        $snippet.find('.generic-snippet .content').first().text()
        || $snippet.find('.generic-snippet .line-clamp-dynamic').first().text()
        || '-'
    )

    return {
        title,
        link,
        source: extractSource($snippet),
        desc: desc || '-'
    }
}

const parseResults = (html) => {
    const $ = cheerio.load(String(html || ''))
    const results = []
    const seen = new Set()

    $('div.snippet[data-pos]').each((_, snippet) => {
        if (results.length >= MAX_RESULTS) return false

        const row = parseSnippet($, snippet)
        if (!row) return

        const key = row.link.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        results.push(row)
    })

    return results
}

const formatResults = (query, results) => {
    const body = results.map((item, index) => (
        `${index + 1}. ${item.title}\n` +
        `× Source: ${item.source}\n` +
        `× Link: ${item.link}\n` +
        `× Desc: ${item.desc}`
    )).join('\n\n')

    return `${body}`
}

export default {
    name: 'brave',
    aliases: ['bravesearch', 'searchbrave'],
    description: 'Cari web dari brave search',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = cleanText(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} group whatsapp`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const { data, status } = await axios.get(SEARCH_URL, {
                params: {
                    q: query,
                    source: 'web'
                },
                timeout: REQUEST_TIMEOUT,
                maxRedirects: 8,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                validateStatus: () => true
            })

            if (status !== 200 || !String(data || '').trim()) {
                throw new Error(`HTTP ${status}`)
            }

            const html = String(data)
            if (/just a moment|enable javascript and cookies|cloudflare/i.test(html)) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Gagal mengakses brave (security challenge)'
                }, { quoted: msg })
            }

            const results = parseResults(html)
            if (!results.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil brave untuk: ${query}`
                }, { quoted: msg })
            }

            const caption = `\`\`\`\n${formatResults(query, results)}\n\`\`\``
            await sock.sendMessage(jid, { text: caption }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const status = err?.response?.status
            const msgErr = status
                ? `❌ Gagal search Brave: HTTP ${status}`
                : `❌ Gagal search Brave: ${err.message || 'Coba lagi nanti.'}`
            await sock.sendMessage(jid, {
                text: msgErr
            }, { quoted: msg })
        }
    }
}

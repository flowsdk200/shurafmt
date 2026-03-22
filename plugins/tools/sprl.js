import axios from 'axios'

const PAGE_URL = 'https://insprl.com/page/bulk-url-shortener'
const API_URL = 'https://insprl.com/useraction/short-url'
const TIMEOUT_MS = 30000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const cleanText = (v) => String(v || '').replace(/\s+/g, ' ').trim()

const extractToken = (html) => {
    const m = String(html || '').match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i)
    return cleanText(m?.[1])
}

const extractCookie = (setCookie = []) =>
    setCookie
        .map((v) => String(v || '').split(';')[0].trim())
        .filter(Boolean)
        .join('; ')

const stripHtml = (html) => cleanText(String(html || '').replace(/<[^>]*>/g, ' '))

const firstHttpUrl = (text) => {
    const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i)
    return cleanText(m?.[0])
}

const parseShortUrl = (payload) => {
    if (!payload) return ''

    if (typeof payload === 'string') {
        const parsed = (() => {
            try {
                return JSON.parse(payload)
            } catch {
                return null
            }
        })()
        if (parsed) return parseShortUrl(parsed)
        return firstHttpUrl(payload)
    }

    if (typeof payload !== 'object') return ''
    if (payload.short_url) return cleanText(payload.short_url)
    if (payload.url) return cleanText(payload.url)

    const msg = String(payload.msg || '')
    if (!msg) return ''

    const fromClass = msg.match(/<span[^>]*class=["'][^"']*\blnk\b[^"']*["'][^>]*>(.*?)<\/span>/i)
    if (fromClass?.[1]) return cleanText(fromClass[1])

    const fromHidden = msg.match(/id=["']_srturl["'][^>]*value=["']([^"']+)["']/i)
    if (fromHidden?.[1]) return cleanText(fromHidden[1])

    return firstHttpUrl(msg)
}

export default {
    name: 'sprl',
    aliases: [],
    description: 'Shorten URL via SPRL',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg })
        const input = cleanText(text)

        if (!input) {
            return reply(`Contoh penggunaan:\n- ${prefix + command} https://wa.me/6285226344606`)
        }

        let target
        try {
            target = new URL(input)
        } catch {
            return reply('❌ URL tidak valid.')
        }

        await react('⏳')

        try {
            const pageRes = await axios.get(PAGE_URL, {
                timeout: TIMEOUT_MS,
                headers: {
                    'user-agent': UA,
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                validateStatus: () => true
            })

            if (pageRes.status !== 200) {
                throw new Error(`SPRL HTTP ${pageRes.status}`)
            }

            const token = extractToken(pageRes.data)
            if (!token) throw new Error('Token SPRL tidak ditemukan')
            const cookie = extractCookie(pageRes.headers?.['set-cookie'] || [])

            const body = new URLSearchParams({
                url_link: target.toString(),
                convert_type: 'random',
                _token: token
            }).toString()

            const postRes = await axios.post(API_URL, body, {
                timeout: TIMEOUT_MS,
                headers: {
                    'user-agent': UA,
                    accept: '*/*',
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'x-requested-with': 'XMLHttpRequest',
                    origin: 'https://insprl.com',
                    referer: PAGE_URL,
                    ...(cookie ? { cookie } : {})
                },
                validateStatus: () => true
            })

            if (postRes.status !== 200) {
                throw new Error(`SPRL submit HTTP ${postRes.status}`)
            }

            const data = postRes.data
            const shortUrl = parseShortUrl(data)
            if (!shortUrl) {
                const rawMsg = cleanText(data?.msg || '')
                throw new Error(stripHtml(rawMsg) || 'Gagal mengambil short URL')
            }

            await reply(
                '```SHORTLINK\n\n' +
                `• Source: SPRL\n` +
                `• Original: ${target.toString()}\n` +
                `• Short: ${shortUrl}` +
                '```'
            )

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await reply(`❌ Gagal shortlink: ${err.message}`)
        }
    }
}

import { gotScraping } from 'got-scraping'
import { CookieJar } from 'tough-cookie'

const HOME_URL = 'https://tiny.cc/'
const CREATE_URL = 'https://tiny.cc/tiny/url/create'
const REQUEST_TIMEOUT = 30000

const cleanText = (v) => String(v || '').replace(/\s+/g, ' ').trim()

const extractSignature = (html) => {
    const s = String(html || '')
    const m1 = s.match(/<input[^>]*name=["']_signature["'][^>]*value=["']([^"']+)["']/i)
    if (m1?.[1]) return cleanText(m1[1])
    const m2 = s.match(/<input[^>]*value=["']([^"']+)["'][^>]*name=["']_signature["']/i)
    return cleanText(m2?.[1])
}

const parseCreateResponse = (body) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body || {})
    let data = null
    try {
        data = JSON.parse(raw)
    } catch {
        return null
    }
    if (!data || Number(data.status) !== 1 || !data.short_url) return null
    return cleanText(String(data.short_url).replace(/\\\//g, '/'))
}

export default {
    name: 'tinycc',
    aliases: ['tiny', 'tcc'],
    description: 'Shorten URL via tiny.cc',
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
            const cookieJar = new CookieJar()

            const homeRes = await gotScraping({
                url: HOME_URL,
                cookieJar,
                timeout: { request: REQUEST_TIMEOUT }
            })

            const signature = extractSignature(homeRes.body)
            if (!signature) throw new Error('Signature tiny.cc tidak ditemukan')

            const createRes = await gotScraping({
                url: CREATE_URL,
                method: 'POST',
                cookieJar,
                headers: { referer: HOME_URL },
                form: {
                    url: target.toString(),
                    domain: '1',
                    no_stats: '1',
                    _signature: signature
                },
                timeout: { request: REQUEST_TIMEOUT },
                throwHttpErrors: false
            })

            const shortUrl = parseCreateResponse(createRes.body)
            if (!shortUrl) {
                const raw = cleanText(
                    typeof createRes.body === 'string'
                        ? createRes.body.slice(0, 300)
                        : JSON.stringify(createRes.body || {}).slice(0, 300)
                )
                throw new Error(raw || `tiny.cc HTTP ${createRes.statusCode || '-'}`)
            }

            await reply(
                '```SHORTLINK\n\n' +
                '• Source: tiny.cc\n' +
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

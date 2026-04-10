import { chromium } from 'playwright'

const ASITHA_ORIGIN = 'https://asitha.top'
const ASITHA_API_BASE = 'https://back.asitha.top/api'
const RECAPTCHA_SITE_KEY = '6LemKk8sAAAAAH5PB3f1EspbMlXjtwv5C8tiMHSm'
const DEFAULT_REACTS = '🗿,🔥,🎉,😱'
const LIMIT_COST = 20

const spendLimit = (usersDb, jid, amount) => {
    const total = Math.max(0, Number(amount) || 0)
    for (let i = 0; i < total; i += 1) {
        usersDb.decrementLimit(jid)
    }
}

const parseInput = (raw = '') => {
    const input = String(raw || '').trim()
    if (!input) return { postLink: '', reacts: DEFAULT_REACTS }

    const [left, right] = input.split('|').map((v) => String(v || '').trim())
    const linkMatch = (left || input).match(/https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[^\s|]+/i)
    const postLink = linkMatch?.[0] || ''
    const reacts = right || DEFAULT_REACTS

    return { postLink, reacts }
}

const validatePostLink = (value = '') => /https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[^\s]+\/\d+/i.test(String(value || '').trim())

const maskToken = (value = '') => {
    const token = String(value || '').trim()
    if (token.length < 16) return '***'
    return `${token.slice(0, 8)}...${token.slice(-6)}`
}

const runReactFlow = async ({ jwtToken, postLink, reacts }) => {
    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled']
    })

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'Asia/Jakarta'
        })

        const page = await context.newPage()
        await page.goto(ASITHA_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 120000 })
        await page.addScriptTag({ url: `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}` })
        await page.waitForFunction(() => typeof window.grecaptcha !== 'undefined', { timeout: 120000 })

        const result = await page.evaluate(async ({ apiBase, jwt, post, emojiCsv, siteKey }) => {
            await new Promise((resolve) => window.grecaptcha.ready(resolve))
            const recaptchaToken = await window.grecaptcha.execute(siteKey, { action: 'post_react' })

            const tempRes = await fetch(`${apiBase}/user/get-temp-token`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${jwt}`
                },
                credentials: 'include',
                body: JSON.stringify({ recaptcha_token: recaptchaToken })
            })

            const tempJson = await tempRes.json().catch(() => ({}))
            if (!tempRes.ok || !tempJson?.token) {
                return {
                    ok: false,
                    stage: 'temp-token',
                    status: tempRes.status,
                    data: tempJson
                }
            }

            const reactRes = await fetch(`${apiBase}/channel/react-to-post?apiKey=${encodeURIComponent(tempJson.token)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    post_link: post,
                    reacts: emojiCsv
                })
            })

            const reactJson = await reactRes.json().catch(() => ({}))
            return {
                ok: reactRes.ok,
                stage: 'react-to-post',
                status: reactRes.status,
                data: reactJson,
                tempToken: tempJson.token
            }
        }, {
            apiBase: ASITHA_API_BASE,
            jwt: jwtToken,
            post: postLink,
            emojiCsv: reacts,
            siteKey: RECAPTCHA_SITE_KEY
        })

        await context.close()
        return result
    } finally {
        await browser.close()
    }
}

export default {
    name: 'reactch',
    aliases: ['reactchannel', 'rch'],
    description: 'Send reaction to WhatsApp channel post via Asitha flow',
    ownerOnly: false,
    ignoreLimit: true,
    execute: async ({ sock, msg, text, react, config, usersDb, sender, isOwner, prefix, command }) => {
        const jid = msg.key.remoteJid
        const { postLink, reacts } = parseInput(text)

        if (!validatePostLink(postLink)) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://whatsapp.com/channel/0029Vb8IWc3FSAsy4xaX991n/289|🗿,🔥,🎉,😱`
            }, { quoted: msg })
        }

        const jwtToken = String(config?.asitha?.jwtToken || process.env.ASITHA_JWT || '').trim()
        if (!jwtToken) {
            return sock.sendMessage(jid, {
                text: 'JWT Asitha belum di-set. Isi config.asitha.jwtToken atau env ASITHA_JWT.'
            }, { quoted: msg })
        }

        const isLikelyJwt = jwtToken.split('.').length === 3
        if (!isLikelyJwt) {
            return sock.sendMessage(jid, {
                text: 'JWT Asitha tidak valid. Format token harus JWT (3 bagian dipisah titik).'
            }, { quoted: msg })
        }

        if (!isOwner) {
            const currentLimit = Number(usersDb?.getLimit?.(sender) || 0)
            if (currentLimit < LIMIT_COST) {
                return sock.sendMessage(jid, {
                    text: `Limit kamu tidak cukup. command ini butuh ${LIMIT_COST} limit (sisa: ${currentLimit}).`
                }, { quoted: msg })
            }
        }

        await react('⏳')

        try {
            const result = await runReactFlow({
                jwtToken,
                postLink,
                reacts
            })

            if (!result?.ok) {
                const message = result?.data?.message || `HTTP ${result?.status || '-'} @ ${result?.stage || 'unknown'}`
                throw new Error(message)
            }

            if (!isOwner) {
                spendLimit(usersDb, sender, LIMIT_COST)
            }

            const remainingLimit = Number(usersDb?.getLimit?.(sender) || 0)

            await react('✅')
            await sock.sendMessage(jid, {
                text:
                    `✅ *REACT CHANNEL BERHASIL*\n\n` +
                    `• Post: ${postLink}\n` +
                    `• Reacts: ${reacts}\n` +
                    `• Cost: ${isOwner ? 0 : LIMIT_COST} limit\n` +
                    `• Sisa limit: ${isOwner ? 'unlimited (owner)' : remainingLimit}\n` +
                    `• Status: ${result.status}`
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ React channel gagal: ${err.message}`
            }, { quoted: msg })
        }
    }
}

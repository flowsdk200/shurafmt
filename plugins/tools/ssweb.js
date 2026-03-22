import axios from 'axios'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const requestSsweb = async (target) => {
    let lastErr = null

    for (let i = 0; i < 3; i++) {
        try {
            const { data } = await axios.get('https://api.baguss.xyz/api/tools/ssweb', {
                params: { url: target },
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            })

            if (data?.status && data?.result) return data.result
            throw new Error(data?.message || 'API tidak mengembalikan screenshot')
        } catch (err) {
            const apiMsg = err?.response?.data?.message
            lastErr = new Error(apiMsg || err.message)
            if (i < 2) await sleep(1200)
        }
    }

    throw lastErr || new Error('Gagal screenshot web')
}

export default {
    name: 'ssweb',
    aliases: ['screenshotweb', 'ss'],
    description: 'Screenshot website dari URL',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://dash.cloudflare.com`
            }, { quoted: msg })
        }

        let target
        try {
            target = new URL(q).toString()
        } catch {
            return sock.sendMessage(jid, {
                text: '❌ URL tidak valid.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const imageUrl = await requestSsweb(target)

            await sock.sendMessage(jid, {
                image: { url: imageUrl },
                caption: `\`\`\`ssweb: ${target}\`\`\``
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
